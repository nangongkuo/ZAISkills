#!/usr/bin/env python3
"""
项目类型检测脚本
自动检测项目是 iOS、Android 还是鸿蒙项目
"""

import os
import sys
import json
from pathlib import Path
from typing import Optional, Dict, List


class ProjectType:
    IOS = "ios"
    ANDROID = "android"
    HARMONY = "harmony"
    UNKNOWN = "unknown"


def check_ios_project(project_root: str) -> bool:
    """检测是否为 iOS 项目"""
    root_path = Path(project_root)

    # 检查特征文件/目录
    ios_indicators = [
        "*.xcodeproj",          # Xcode 项目文件
        "*.xcworkspace",        # Xcode workspace
        "Podfile",              # CocoaPods 依赖管理
        "Podfile.lock",         # CocoaPods 锁文件
        "*.xcworkspace/contents.xcworkspacedata",  # workspace 数据文件
    ]

    for pattern in ios_indicators:
        matches = list(root_path.glob(pattern))
        if matches:
            return True

    # 检查 .xcodeproj 目录是否存在
    for item in root_path.iterdir():
        if item.is_dir() and item.suffix == ".xcodeproj":
            return True
        if item.is_dir() and item.suffix == ".xcworkspace":
            return True

    return False


def check_android_project(project_root: str) -> bool:
    """检测是否为 Android 项目"""
    root_path = Path(project_root)

    # 检查特征文件
    android_indicators = [
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "gradlew",
        "gradlew.bat",
    ]

    for indicator in android_indicators:
        if (root_path / indicator).exists():
            return True

    # 检查 app 目录下的 build.gradle（某些项目结构）
    app_gradle = root_path / "app" / "build.gradle"
    app_gradle_kts = root_path / "app" / "build.gradle.kts"
    if app_gradle.exists() or app_gradle_kts.exists():
        return True

    return False


def check_harmony_project(project_root: str) -> bool:
    """检测是否为鸿蒙项目"""
    root_path = Path(project_root)

    # 检查特征文件/目录
    harmony_indicators = [
        "build-profile.json5",  # 鸿蒙构建配置
        "hvigorfile.ts",        # Hvigor 构建脚本
        "hvigorw",              # Hvgradle wrapper
        "oh_modules",           # 鸿蒙模块目录
        "AppScope",             # 鸿蒙应用作用域目录
        "oh-package.json5",     # 鸿蒙包配置
    ]

    for indicator in harmony_indicators:
        if (root_path / indicator).exists():
            return True

    # 检查 entry 模块结构（鸿蒙典型结构）
    entry_path = root_path / "entry"
    if entry_path.exists() and entry_path.is_dir():
        # 检查 entry/src/main/ets 目录
        ets_path = entry_path / "src" / "main" / "ets"
        if ets_path.exists():
            return True
        # 检查 entry 下的 build-profile.json5
        entry_build_profile = entry_path / "build-profile.json5"
        if entry_build_profile.exists():
            return True

    return False


def check_sync_necessity(project_root: str, project_type: str, target_name: str = "Living") -> Dict:
    """
    iOS 项目 sync 必要性检测.
    通过多重检查判断是否需要 anc sync，覆盖以下场景:
    1. Podfile.lock 与 Pods/Manifest.lock 一致性 (CocoaPods 依赖变更)
    2. KMP 框架存在性 (anc sync 下载远端二进制)
    3. Portal 项目初始化 (anc sync 创建 Portal.xcodeproj 并注入 Build Phase)
    4. KMPMicroApplication.plist 生成 (anc sync 合并 KMP pod plist)
    5. xcconfig 配置完整性 (pod install 生成，anc sync 修改)
    """
    if project_type != ProjectType.IOS:
        return {"sync_needed": False, "status": "not_applicable", "reason": "非 iOS 项目"}

    root = Path(project_root)
    lockfile = root / "Podfile.lock"
    manifest = root / "Pods" / "Manifest.lock"

    if not lockfile.exists():
        return {"sync_needed": True, "status": "needed", "reason": "Podfile.lock 不存在"}

    if not manifest.exists():
        return {"sync_needed": True, "status": "needed", "reason": "Pods/Manifest.lock 不存在，需要 sync"}

    if lockfile.read_bytes() != manifest.read_bytes():
        return {"sync_needed": True, "status": "needed", "reason": "Podfile.lock 与 Pods/Manifest.lock 不一致"}

    kmp_base = root / "Pods" / "Portal" / "Portal" / "kmp_shell_wrapper" / "build" / "framework"
    missing = [v for v in ("debug", "release") if not (kmp_base / v / "AlipayKMP.framework").exists()]
    if missing:
        return {"sync_needed": True, "status": "needed", "reason": f"KMP 框架缺失: {', '.join(m + '/AlipayKMP.framework' for m in missing)}"}

    portal_xcodeproj = root / "Pods" / "Portal" / "Portal" / "Portal.xcodeproj"
    if not portal_xcodeproj.exists():
        return {"sync_needed": True, "status": "needed", "reason": "Portal 项目未初始化（Portal.xcodeproj 不存在），需要 sync"}

    kmp_plist = root / "Pods" / "Portal" / "Portal" / "Portal" / "Resources" / "KMPMicroApplication.plist"
    if not kmp_plist.exists():
        return {"sync_needed": True, "status": "needed", "reason": "KMPMicroApplication.plist 未生成，需要 sync"}

    pods_target_support = root / "Pods" / "Target Support Files" / f"Pods-{target_name}"
    if not pods_target_support.exists():
        return {"sync_needed": True, "status": "needed", "reason": f"Pods Target Support Files (Pods-{target_name}) 不完整，需要 sync"}

    return {"sync_needed": False, "status": "skipped", "reason": "所有检查通过，无需 sync"}


def detect_project_type(project_root: str) -> Dict:
    """
    检测项目类型

    Args:
        project_root: 项目根目录路径

    Returns:
        包含项目类型和检测详情的字典
    """
    if not os.path.exists(project_root):
        return {
            "type": ProjectType.UNKNOWN,
            "error": f"项目路径不存在：{project_root}",
            "details": {}
        }

    details = {
        "ios": check_ios_project(project_root),
        "android": check_android_project(project_root),
        "harmony": check_harmony_project(project_root)
    }

    # 确定项目类型（优先级：鸿蒙 > iOS > Android）
    # 注意：某些项目可能同时包含多个平台的代码
    project_type = ProjectType.UNKNOWN

    if details["harmony"]:
        project_type = ProjectType.HARMONY
    elif details["ios"]:
        project_type = ProjectType.IOS
    elif details["android"]:
        project_type = ProjectType.ANDROID

    return {
        "type": project_type,
        "error": None,
        "details": details,
        "project_root": project_root,
        "sync": check_sync_necessity(project_root, project_type)
    }


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法：python detect_project_type.py <项目根目录>")
        print("输出：JSON 格式的检测结果")
        sys.exit(1)

    project_root = sys.argv[1]
    result = detect_project_type(project_root)

    # 输出 JSON 结果
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 返回码：0=成功识别，1=未知类型或错误
    sys.exit(0 if result["type"] != ProjectType.UNKNOWN else 1)


if __name__ == "__main__":
    main()
