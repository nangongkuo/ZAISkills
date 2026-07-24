#!/usr/bin/env python3
"""
iOS 新文件注册脚本
检测 git 未跟踪的 .m/.h/.swift 文件，自动加入 xcodeproj 的对应 build phase.
"""

import json
import os
import subprocess
import sys
from pathlib import Path


def find_xcodeproj(repo_path: str):
    root = Path(repo_path)
    projects = [
        d for d in root.iterdir()
        if d.is_dir() and d.suffix == ".xcodeproj" and d.name != "Pods.xcodeproj"
    ]
    return projects[0] if projects else None


def get_new_source_files(repo_path: str):
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_path, capture_output=True, text=True
    )
    new_files = []
    for line in result.stdout.strip().splitlines():
        if not line:
            continue
        status = line[:2]
        filepath = line[3:].strip().strip('"')
        if status in ("??", "A ", "AM"):
            ext = os.path.splitext(filepath)[1].lower()
            if ext in (".m", ".h", ".swift", ".mm"):
                new_files.append(filepath)
    return new_files


def add_files(repo_path: str):
    xcodeproj = find_xcodeproj(repo_path)
    if not xcodeproj:
        return {"added": [], "skipped": [], "target": None, "project": None, "error": None}

    new_files = get_new_source_files(repo_path)
    if not new_files:
        return {"added": [], "skipped": [], "target": None, "project": xcodeproj.name, "error": None}

    try:
        from pbxproj import XcodeProject
    except ImportError:
        return {"added": [], "skipped": new_files, "target": None, "project": xcodeproj.name,
                "error": "pbxproj 未安装，请执行 pip3 install pbxproj"}

    pbxproj_path = xcodeproj / "project.pbxproj"
    project = XcodeProject.load(str(pbxproj_path))

    targets = [t for t in project.objects.get_targets() if hasattr(t, 'buildPhases')]
    if not targets:
        return {"added": [], "skipped": new_files, "target": None, "project": xcodeproj.name,
                "error": "未找到 native target"}

    target = targets[0]
    target_name = target.name if hasattr(target, 'name') else str(target)

    existing_files = set()
    for obj in project.objects.get_objects_in_section('PBXFileReference'):
        ref = project.objects[obj]
        if hasattr(ref, 'path'):
            existing_files.add(ref.path)

    added = []
    skipped = []

    for filepath in new_files:
        basename = os.path.basename(filepath)
        if basename in existing_files:
            skipped.append(filepath)
            continue

        abs_path = os.path.join(repo_path, filepath)
        ext = os.path.splitext(filepath)[1].lower()

        try:
            if ext in (".m", ".swift", ".mm"):
                project.add_file(abs_path, force=False, target_name=target_name)
            elif ext == ".h":
                project.add_file(abs_path, force=False, target_name=target_name, header_scope="PUBLIC")
            added.append(filepath)
        except Exception as e:
            if "already" in str(e).lower() or "exists" in str(e).lower():
                skipped.append(filepath)
            else:
                skipped.append(filepath)

    if added:
        project.save()

    return {
        "added": added,
        "skipped": skipped,
        "target": target_name,
        "project": xcodeproj.name,
        "error": None
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法：python3 add_files_to_xcodeproj.py <repo_path>"}))
        sys.exit(1)

    repo_path = sys.argv[1]
    if not os.path.isdir(repo_path):
        print(json.dumps({"error": f"路径不存在：{repo_path}"}))
        sys.exit(1)

    result = add_files(repo_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(1 if result.get("error") else 0)


if __name__ == "__main__":
    main()
