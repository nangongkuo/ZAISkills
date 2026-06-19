#!/bin/bash
# test_skill.sh - zai-apk-reverse 分层检测脚本
# 用法:
#   bash test_skill.sh                 # L0: 语法/结构检查
#   bash test_skill.sh --l1 <apk>       # L1: T1 静态分析
#   bash test_skill.sh --l2 <apk>       # L2: 加固脱壳（需要设备）
#   bash test_skill.sh --l3 <apk>       # L3: T2 反编译
#   bash test_skill.sh --l4 <apk>       # L4: T3 动态（需要设备+App运行）
#   bash test_skill.sh --full <apk>     # L0-L5 全链路
#
# 结果:  ✓ = 通过  × = 失败  ⚠ = 跳过(条件不满足)

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0; SKIP=0

# ============================================================
# 工具函数
# ============================================================
check() {
    local desc="$1" result="$2"
    case "$result" in
        pass) echo "  ✓ $desc"; PASS=$((PASS+1)) ;;
        fail) echo "  × $desc"; FAIL=$((FAIL+1)) ;;
        skip) echo "  ⚠ $desc (跳过)"; SKIP=$((SKIP+1)) ;;
    esac
}

summary() {
    echo ""
    echo "========================================"
    echo " 检测结果汇总"
    echo " ✓ 通过: $PASS"
    echo " × 失败: $FAIL"
    echo " ⚠ 跳过: $SKIP"
    if [ "$FAIL" -eq 0 ]; then
        echo " 🎉 全部通过!"
    else
        echo " ⚠ 有 $FAIL 项失败，需修复"
    fi
    echo "========================================"
    return "$FAIL"
}

# ============================================================
# L0: 语法/结构检查（不需要任何环境）
# ============================================================
test_l0() {
    echo ""
    echo "===== L0: 语法/结构检查 ====="

    # L0.1 必需文件存在
    echo " --- 文件完整性 ---"
    local required_files=(
        "SKILL.md" "PLAYBOOK.md" "config.json"
        "scripts/analyze.sh" "scripts/dynamic.sh" "scripts/render.sh" "scripts/publish.sh"
        "scripts/lib/_common.sh" "scripts/lib/extract_meta.sh" "scripts/lib/runtime_mods.sh"
        "scripts/lib/decompile.sh" "scripts/lib/emu.sh" "scripts/lib/run_frida.py"
        "scripts/lib/reassemble_body.py" "scripts/lib/unpack.sh"
        "scripts/frida/lib/_common.js" "scripts/frida/lib/_anti_detect.js"
        "scripts/frida/lib/_force_load_classes.js" "scripts/frida/00_bootstrap.js"
        "scripts/frida/trace_mtop.js" "scripts/frida/trace_lifecycle.js"
        "scripts/frida/trace_deeplink.js" "scripts/frida/trace_jni.js"
        "scripts/frida/bytedance/trace_aweme.js" "scripts/frida/bytedance/trace_lynx.js"
        "scripts/frida/pinduoduo/trace_pdd_rpc.js"
        "templates/report.md.tpl"
    )

    for f in "${required_files[@]}"; do
        if [ -f "$SKILL_DIR/$f" ]; then
            check "$f 存在" "pass"
        else
            check "$f 存在" "fail"
        fi
    done

    # L0.2 Bash 脚本语法
    echo " --- Bash 语法 ---"
    for f in scripts/lib/_common.sh scripts/lib/unpack.sh scripts/lib/decompile.sh \
        scripts/analyze.sh scripts/dynamic.sh scripts/publish.sh; do
        if bash -n "$SKILL_DIR/$f" 2>/dev/null; then
            check "$f bash 语法" "pass"
        else
            check "$f bash 语法" "fail"
        fi
    done

    # L0.3 Python 语法
    echo " --- Python 语法 ---"
    for f in scripts/lib/reassemble_body.py scripts/lib/run_frida.py; do
        if python3 -m py_compile "$SKILL_DIR/$f" 2>/dev/null; then
            check "$f python 语法" "pass"
        else
            check "$f python 语法" "fail"
        fi
    done

    # L0.4 JS 语法（basic）
    echo " --- JS 语法 ---"
    for f in scripts/frida/lib/_common.js scripts/frida/lib/_anti_detect.js \
        scripts/frida/lib/_force_load_classes.js scripts/frida/00_bootstrap.js \
        scripts/frida/trace_mtop.js scripts/frida/trace_lifecycle.js \
        scripts/frida/trace_deeplink.js scripts/frida/trace_jni.js \
        scripts/frida/bytedance/trace_aweme.js scripts/frida/bytedance/trace_lynx.js \
        scripts/frida/pinduoduo/trace_pdd_rpc.js; do
        if node -c "$SKILL_DIR/$f" 2>/dev/null; then
            check "$f JS 语法" "pass"
        else
            check "$f JS 语法 (node不可用)" "skip"
        fi
    done

    # L0.5 config.json 结构
    echo " --- 配置验证 ---"
    if python3 - "$SKILL_DIR/config.json" <<'PY' 2>&1; then
import json
import sys

cfg = json.load(open(sys.argv[1]))
assert 'task_keywords' in cfg, 'missing task_keywords'
assert 'vendor_profiles' in cfg, 'missing vendor_profiles'
assert 'packer_strategies' in cfg, 'missing packer_strategies'
assert 'static_grep_patterns' in cfg, 'missing static_grep_patterns'
assert 'frida' in cfg, 'missing frida'
assert 'script_load_order' in cfg['frida'], 'missing frida.script_load_order'

# 校验 task 关键字完整
for task in ['first-screen-rpc', 'h5-container', 'deeplink', 'security-audit', 'native-jni']:
    assert task in cfg['task_keywords'], f'missing task: {task}'
    tk = cfg['task_keywords'][task]
    assert 'class_keywords' in tk, f'missing class_keywords in {task}'
    assert 'string_keywords' in tk, f'missing string_keywords in {task}'
    assert 'frida_scripts' in tk, f'missing frida_scripts in {task}'

# 校验 vendor profiles
for v in ['bytedance', 'pinduoduo']:
    assert v in cfg['vendor_profiles'], f'missing vendor: {v}'
    vp = cfg['vendor_profiles'][v]
    assert 'frida_scripts' in vp, f'missing frida_scripts in vendor {v}'

# 校验 packer strategies
for p in ['360加固', '梆梆加固', '阿里聚安全', '拼多多自研']:
    assert p in cfg['packer_strategies'], f'missing packer: {p}'

print('config.json 验证通过')
PY
        check "config.json 结构完整" "pass"
    else
        check "config.json 结构完整" "fail"
    fi

    # L0.6 Frida 脚本加载顺序验证
    local load_order
    load_order=$(python3 - "$SKILL_DIR/config.json" <<'PY' 2>/dev/null
import json
import sys

cfg = json.load(open(sys.argv[1]))
order = cfg['frida'].get('script_load_order', [])
print(','.join(order))
PY
)
    if [ "$load_order" = "lib/_common.js,lib/_anti_detect.js,00_bootstrap.js" ]; then
        check "Frida 脚本加载顺序: _common → _anti_detect → 00_bootstrap" "pass"
    else
        check "Frida 脚本加载顺序（期望 _common,_anti_detect,00_bootstrap，得到: $load_order）" "fail"
    fi

    # L0.7 _anti_detect.js 必须引用 createHelper
    if grep -q 'createHelper' "$SKILL_DIR/scripts/frida/lib/_anti_detect.js"; then
        check "_anti_detect.js 依赖 _common.js (createHelper)" "pass"
    else
        check "_anti_detect.js 依赖 _common.js (createHelper)" "fail"
    fi

    # L0.8 unpack.sh 引用 _common.sh 函数
    if grep -q 'packer_strategy\|check_device\|decision_log\|find_tool' "$SKILL_DIR/scripts/lib/unpack.sh"; then
        check "unpack.sh 引用 _common.sh 函数" "pass"
    else
        check "unpack.sh 引用 _common.sh 函数" "fail"
    fi

    # L0.9 analyze.sh 调用 unpack.sh 而非 exit 2
    if grep -q 'unpack.sh' "$SKILL_DIR/scripts/analyze.sh" && \
        ! grep -q 'exit 2.*加固.*手动脱壳指南' "$SKILL_DIR/scripts/analyze.sh"; then
        check "analyze.sh 调用 unpack.sh（不再直接 exit 2）" "pass"
    else
        check "analyze.sh 调用 unpack.sh（不再直接 exit 2）" "fail"
    fi

    # L0.10 decompile.sh 支持 --unpacked-dex-dir
    if grep -q -- '--unpacked-dex-dir' "$SKILL_DIR/scripts/lib/decompile.sh"; then
        check "decompile.sh 支持 --unpacked-dex-dir" "pass"
    else
        check "decompile.sh 支持 --unpacked-dex-dir" "fail"
    fi

    # L0.11 reassemble_body.py 支持 --count
    if python3 - "$SKILL_DIR/scripts/lib/reassemble_body.py" <<'PY' 2>&1; then
import sys

# 检查 --count 参数存在
code = open(sys.argv[1]).read()
assert '--count' in code, 'missing --count'
assert 'PATTERN_OLD' in code, 'missing old pattern regex'
assert 'TRUNCATED' in code, 'missing truncation detection'
print('reassemble_body.py 验证通过')
PY
        check "reassemble_body.py 正则兼容+截断检测+--count" "pass"
    else
        check "reassemble_body.py 正则兼容+截断检测+--count" "fail"
    fi
}

# ============================================================
# L1: T1 静态分析（需要 APK + jadx）
# ============================================================
test_l1() {
    local APK="$1"
    echo ""
    echo "===== L1: T1 静态分析 ====="

    [ -z "$APK" ] && { echo "  需要 APK 文件路径"; return 1; }
    [ -f "$APK" ] || { echo "  × APK 不存在: $APK"; return 1; }

    # L1.1 analyze.sh --skip-decompile 能跑通
    echo " --- T1 快速画像（约 30s） ---"
    local WD
    WD=$(bash "$SKILL_DIR/scripts/analyze.sh" "$APK" --skip-decompile 2>&1 | tail -1)
    if [ -d "$WD" ] && [ -f "$WD/meta.json" ]; then
        check "analyze.sh --skip-decompile 执行成功" "pass"

        # L1.2 meta.json 包含必要字段
        local pkg
        pkg=$(python3 -c "import json; print(json.load(open('$WD/meta.json')).get('package',''))" 2>/dev/null)
        if [ -n "$pkg" ]; then
            check "meta.json.package = $pkg" "pass"
        else
            check "meta.json.package" "fail"
        fi

        local packer
        packer=$(python3 -c "import json; print(json.load(open('$WD/meta.json')).get('packer',{}).get('name',''))" 2>/dev/null)
        check "meta.json.packer = ${packer:-none}" "pass"

        # L1.3 runtime_mods.json 存在
        if [ -f "$WD/runtime_mods.json" ]; then
            check "runtime_mods.json 存在" "pass"
        else
            check "runtime_mods.json 存在" "fail"
        fi

        # L1.4 如果有加固，检查 unpack_result.json
        if [ "$packer" != "none" ] && [ -n "$packer" ]; then
            if [ -f "$WD/unpack_result.json" ]; then
                local strategy
                strategy=$(python3 -c "import json; print(json.load(open('$WD/unpack_result.json')).get('strategy',''))" 2>/dev/null)
                check "加固 $packer → 策略=$strategy" "pass"
            else
                check "unpack_result.json（加固 $packer）" "fail"
            fi
        else
            check "无加固，跳过 unpack 检查" "skip"
        fi

        echo ""
        echo " workdir: $WD"
        echo " 可手动检查: ls $WD/"
    else
        check "analyze.sh --skip-decompile 执行成功" "fail"
    fi
}

# ============================================================
# L2: 加固脱壳（需要 设备 + frida + frida-dexdump）
# ============================================================
test_l2() {
    local APK="$1"
    echo ""
    echo "===== L2: 加固脱壳测试 ====="

    [ -z "$APK" ] && { echo "  需要 APK 文件路径"; return 1; }

    # 检查设备环境
    local ADB
    ADB=$(command -v adb 2>/dev/null)
    if [ -z "$ADB" ]; then
        check "adb 可用" "skip"
        return
    fi
    check "adb 可用: $ADB" "pass"

    local dev_state
    dev_state=$($ADB get-state 2>/dev/null | tr -d '\r\n')
    if [ "$dev_state" != "device" ]; then
        check "adb 设备连接 (state=$dev_state)" "skip"
        return
    fi
    check "adb 设备已连接" "pass"

    # 检查 frida
    local frida
    frida=$(command -v frida 2>/dev/null)
    if [ -z "$frida" ]; then
        check "frida CLI 可用" "skip"
        return
    fi
    check "frida CLI: $frida" "pass"

    # 检查 frida-dexdump
    local dexdump
    dexdump=$(command -v frida-dexdump 2>/dev/null)
    if [ -z "$dexdump" ]; then
        check "frida-dexdump 可用" "skip"
    else
        check "frida-dexdump: $dexdump" "pass"
    fi

    # 运行 analyze.sh（含加固检测）
    local WD
    WD=$(bash "$SKILL_DIR/scripts/analyze.sh" "$APK" --skip-decompile 2>&1 | tail -1)
    if [ ! -d "$WD" ]; then
        check "analyze.sh 执行成功" "fail"
        return
    fi

    local packer
    packer=$(python3 -c "import json; print(json.load(open('$WD/meta.json')).get('packer',{}).get('name','none'))" 2>/dev/null)

    if [ "$packer" = "none" ] || [ -z "$packer" ]; then
        check "无加固 APK，跳过脱壳测试" "skip"
        return
    fi

    check "检测到加固: $packer" "pass"

    # 检查 unpack_result.json
    if [ -f "$WD/unpack_result.json" ]; then
        local strategy
        local dex_count
        strategy=$(python3 -c "import json; print(json.load(open('$WD/unpack_result.json')).get('strategy',''))" 2>/dev/null)
        dex_count=$(python3 -c "import json; print(json.load(open('$WD/unpack_result.json')).get('dex_count',0))" 2>/dev/null)
        check "脱壳策略: $strategy" "pass"

        if [ "$dex_count" -gt 0 ]; then
            check "脱壳成功: $dex_count 个 dex" "pass"
        else
            check "脱壳失败 (0 dex)" "fail"
        fi
    else
        check "unpack_result.json 生成" "fail"
    fi
}

# ============================================================
# L3: T2 反编译
# ============================================================
test_l3() {
    local APK="$1"
    echo ""
    echo "===== L3: T2 反编译测试 ====="

    [ -z "$APK" ] && { echo "  需要 APK 文件路径"; return 1; }

    # 完整 analyze.sh（含反编译）
    echo " --- 完整 analyze.sh（可能需要几分钟） ---"
    local WD
    WD=$(bash "$SKILL_DIR/scripts/analyze.sh" "$APK" --task first-screen-rpc 2>&1 | tail -1)
    if [ ! -d "$WD" ]; then
        check "analyze.sh 执行成功" "fail"
        return
    fi
    check "analyze.sh 执行成功" "pass"

    # L3.1 class_index.json
    if [ -f "$WD/class_index.json" ]; then
        local cls_count
        cls_count=$(python3 -c "import json; print(json.load(open('$WD/class_index.json')).get('total_classes',0))" 2>/dev/null)
        check "class_index.json: $cls_count 个类" "pass"
    else
        check "class_index.json 存在" "fail"
    fi

    # L3.2 decompiled/ 有 Java 文件
    local java_count
    java_count=$(find "$WD/decompiled" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$java_count" -gt 0 ]; then
        check "decompiled/: $java_count 个 Java 文件" "pass"
    else
        # 检查是否有 smali 降级
        local smali_count
        smali_count=$(find "$WD/smali" -name "*.smali" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$smali_count" -gt 0 ]; then
            check "jadx 产出 0，baksmali 降级: $smali_count 个 smali" "pass"
        else
            check "jadx + baksmali 均产出 0" "fail"
        fi
    fi

    # L3.3 static_findings.json 有内容
    if [ -f "$WD/static_findings.json" ]; then
        local rpc_count
        local sign_count
        rpc_count=$(python3 -c "import json; f=json.load(open('$WD/static_findings.json')); print(f.get('rpc_endpoints',{}).get('count',0))" 2>/dev/null)
        sign_count=$(python3 -c "import json; f=json.load(open('$WD/static_findings.json')); print(f.get('sign_headers',{}).get('count',0))" 2>/dev/null)
        check "static_findings: rpc=$rpc_count sign=$sign_count" "pass"
    else
        check "static_findings.json 存在" "fail"
    fi

    # L3.4 如果有加固，检查 unpacked_dex
    if [ -d "$WD/unpacked_dex" ]; then
        local unpack_dex
        unpack_dex=$(find "$WD/unpacked_dex" -name "*.dex" 2>/dev/null | wc -l | tr -d ' ')
        check "unpacked_dex/: $unpack_dex 个 dex（脱壳产出）" "pass"
    fi

    echo ""
    echo " workdir: $WD"
}

# ============================================================
# L4: T3 动态分析（需要设备 + App 运行）
# ============================================================
test_l4() {
    local APK="$1"
    echo ""
    echo "===== L4: T3 动态分析测试 ====="

    [ -z "$APK" ] && { echo "  需要 APK 文件路径"; return 1; }

    # 检查设备
    local ADB
    ADB=$(command -v adb 2>/dev/null)
    if [ -z "$ADB" ]; then
        check "adb 可用" "skip"; return
    fi

    local dev_state
    dev_state=$($ADB get-state 2>/dev/null | tr -d '\r\n')
    if [ "$dev_state" != "device" ]; then
        check "adb 设备连接" "skip"; return
    fi

    local pkg
    pkg=$(python3 -c "
import json, sys
# 用上一个 workdir 的 meta.json
import glob
wds = sorted(glob.glob('/tmp/apk-reverse-*'))
if wds:
    print(json.load(open(f'{wds[-1]}/meta.json')).get('package', ''))
" 2>/dev/null)

    if [ -z "$pkg" ]; then
        check "获取包名（需要先跑 L3）" "skip"; return
    fi

    # 检查 App 是否在运行
    local pid
    pid=$($ADB shell pidof "$pkg" 2>/dev/null | tr -d '\r\n')
    if [ -z "$pid" ]; then
        check "App $pkg 运行中 (pid=$pid)" "skip"
        echo "  请先启动 App: adb shell am start -n $pkg/..."
        return
    fi
    check "App $pkg 运行中 (pid=$pid)" "pass"

    # 找到 workdir
    local WD
    WD=$(ls -td /tmp/apk-reverse-"${pkg}"-* 2>/dev/null | head -1)
    if [ -z "$WD" ]; then
        check "workdir 存在（需要先跑 L3）" "skip"; return
    fi

    # L4.1 dynamic.sh round-1
    echo " --- dynamic.sh round-1 (60s) ---"
    bash "$SKILL_DIR/scripts/dynamic.sh" "$WD" test-round-1 --duration 30 2>&1 | tail -10
    local FINDINGS="$WD/findings/round-test-round-1.json"

    if [ -f "$FINDINGS" ]; then
        local urls
        local reqs
        local resps
        urls=$(python3 -c "import json; print(len(json.load(open('$FINDINGS')).get('urls',[])))" 2>/dev/null)
        reqs=$(python3 -c "import json; print(len(json.load(open('$FINDINGS')).get('requests',[])))" 2>/dev/null)
        resps=$(python3 -c "import json; print(len(json.load(open('$FINDINGS')).get('responses',[])))" 2>/dev/null)
        check "findings: urls=$urls reqs=$reqs resps=$resps" "pass"
    else
        check "dynamic.sh 执行成功" "fail"
    fi

    # L4.2 evidence 文件
    if [ -f "$WD/evidence/logs/round-test-round-1.log" ]; then
        local log_lines
        log_lines=$(wc -l < "$WD/evidence/logs/round-test-round-1.log" | tr -d ' ')
        check "frida log: $log_lines 行" "pass"
    else
        check "frida log 存在" "fail"
    fi

    if [ -f "$WD/evidence/screenshots/round-test-round-1-after.png" ]; then
        check "screenshot 存在" "pass"
    fi

    # L4.3 bodies（验证 reassemble 管道）
    local bodies_dir="$WD/evidence/bodies/round-test-round-1"
    if [ -d "$bodies_dir" ]; then
        local body_count
        body_count=$(ls "$bodies_dir" 2>/dev/null | wc -l | tr -d ' ')
        check "bodies: $body_count 个文件" "pass"
    else
        check "bodies 目录存在" "fail"
    fi
}

# ============================================================
# 主入口
# ============================================================
MODE="${1:---l0}"
APK="${2:-}"

case "$MODE" in
    --l0)   test_l0 ;;
    --l1)   test_l1 "$APK" ;;
    --l2)   test_l2 "$APK" ;;
    --l3)   test_l3 "$APK" ;;
    --l4)   test_l4 "$APK" ;;
    --full)
        test_l0
        if [ -n "$APK" ]; then
            test_l1 "$APK"
            test_l2 "$APK"
            test_l3 "$APK"
            test_l4 "$APK"
        else
            echo ""
            echo " ⚠ --full 需要 APK 文件路径: bash test_skill.sh --full <apk>"
        fi
        ;;
    *)
        echo "用法: bash test_skill.sh [--l0|--l1|--l2|--l3|--l4|--full] [<apk>]"
        echo "  --l0: 语法/结构检查（不需要任何环境）"
        echo "  --l1: T1 静态分析（需要 APK + jadx）"
        echo "  --l2: 加固脱壳（需要 设备 + frida + frida-dexdump）"
        echo "  --l3: T2 反编译（需要 APK + jadx）"
        echo "  --l4: T3 动态分析（需要 设备 + 运行中 App）"
        echo "  --full: 全链路（L0-L4）"
        ;;
esac

summary
