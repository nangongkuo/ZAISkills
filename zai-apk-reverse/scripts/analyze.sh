#!/bin/bash
# analyze.sh - v3 入口 1: T1+T2 全自动反编译/静态分析
#
# 用法:
#   analyze.sh <apk> [--task <task>] [--skip-decompile] [--vendor <vendor>] [--top-n <N>]
#
# 流程:
#   1. 环境自检
#   2. extract_meta.sh    -> workdir/meta.json (resume: 已存在则跳过)
#   3. runtime_mods.sh    -> workdir/runtime_mods.json (resume: 已存在则跳过)
#   4. packer 检查       -> packer != none 时尝试自动脱壳 (instead of exit 2)
#   5. decompile.sh      -> workdir/class_index.json + decompiled/
#   6. 静态 grep         -> workdir/static_findings.json
#   7. 打印 workdir 路径供后续 dynamic.sh / render.sh 用
#
# 输出: 单一 workdir 路径（最后一行 stdout），所有产物在该目录

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SKILL_DIR
source "$SKILL_DIR/scripts/lib/_common.sh"

# ============================================================
# 参数解析
# ============================================================
APK=""
TASK=""
VENDOR=""
SKIP_DECOMPILE=0
TOP_N=0

while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift 2 ;;
    --vendor) VENDOR="$2"; shift 2 ;;
    --skip-decompile) SKIP_DECOMPILE=1; shift ;;
    --top-n) TOP_N="$2"; shift 2 ;;
    --help|-h)
      cat <<EOF
用法: analyze.sh <apk> [--task <task>] [--vendor <vendor>] [--skip-decompile] [--top-n <N>]

task 可选值（来自 config.json）:
$(python3 -c "import json; cfg=json.load(open('$SKILL_DIR/config.json')); tasks=cfg.get('task_keywords') or cfg.get('task-keywords') or {}; [print('  - ' + t) for t in tasks if not t.startswith('_')]")

vendor 可选值（影响关键字和 frida 脚本选择）:
$(python3 -c "import json; vp=json.load(open('$SKILL_DIR/config.json')).get('vendor_profiles', {}); [print('  - ' + v) for v in vp] if vp else print('  (无 vendor 配置)')")

--top-n <N>   限制最多反编译 N 个 dex（大 APK 加速）
EOF
      exit 0
      ;;
    *)
      if [ -z "$APK" ]; then APK="$1"; else die "未知参数: $1"; fi
      shift
      ;;
  esac
done

[ -z "$APK" ] && die "用法: analyze.sh <apk> [--task <task>] [--vendor <vendor>]"
[ -f "$APK" ] || die "APK 不存在: $APK"

# ============================================================
# 环境自检
# ============================================================
log "===== 环境自检 ====="
MISSING=0
for tool in jadx apkanalyzer; do
  p=$(find_tool "$tool")
  if [ -z "$p" ]; then
    warn "$tool 未找到"
    MISSING=$((MISSING+1))
  else
    ok "$tool: $p"
  fi
done

# 可选
for tool in apksigner aapt frida baksmali; do
  p=$(find_tool "$tool")
  [ -n "$p" ] && ok "$tool: $p (可选)"
done

[ "$MISSING" -gt 0 ] && die "缺少 $MISSING 个核心工具" 1

# ============================================================
# 创建 workdir（先抓 pkg 名，再用 pkg 命名 dir）
# ============================================================
TMPDIR_PRE=$(mktemp -d)
"$SKILL_DIR/scripts/lib/extract_meta.sh" "$APK" > "$TMPDIR_PRE/meta.json" 2> "$TMPDIR_PRE/err.log" || die "extract_meta 失败"
PKG=$(json_get "$TMPDIR_PRE/meta.json" .package)
VER=$(json_get "$TMPDIR_PRE/meta.json" .version_name)
[ -z "$PKG" ] && die "无法解析包名（看 $TMPDIR_PRE/err.log）"

WORKDIR=$(new_workdir "$PKG")
log "===== 工作目录: $WORKDIR ====="
mv "$TMPDIR_PRE/meta.json" "$WORKDIR/"
rm -rf "$TMPDIR_PRE"

# 记录任务、vendor
echo "$TASK" > "$WORKDIR/.task"
[ -n "$VENDOR" ] && echo "$VENDOR" > "$WORKDIR/.vendor"
decision_log "$WORKDIR" "analyze.sh 启动: apk=$APK task=${TASK:-(unspecified)} vendor=${VENDOR:-(auto)} pkg=$PKG version=$VER"

# ============================================================
# 1. runtime_mods (resume: 已存在且有效则跳过)
# ============================================================
if check_step "$WORKDIR" "runtime_mods" "$WORKDIR/runtime_mods.json"; then
  log "runtime_mods 已存在，跳过"
else
  log "===== runtime_mods ====="
  "$SKILL_DIR/scripts/lib/runtime_mods.sh" "$APK" > "$WORKDIR/runtime_mods.json" 2>> "$WORKDIR/err.log" || warn "runtime_mods 出错"
fi

# ============================================================
# 2. packer 检查 -> 自动脱壳（核心改造: 不再 exit 2）
# ============================================================
PACKER=$(json_get "$WORKDIR/meta.json" .packer.name)
DECOMPILE_INPUT="$APK"  # 默认用原始 APK
DECOMPILE_EXTRA_ARGS=""

if [ "$PACKER" != "none" ] && [ -n "$PACKER" ]; then
  log "===== 检测到加固: $PACKER ====="
  STRATEGY=$(packer_strategy "$PACKER")
  log "脱壳策略: $STRATEGY"

  if [ "$STRATEGY" = "manual" ]; then
    # 不可自动脱壳: 仅 T1，保留手动指南
    warn "加固 $PACKER 不支持自动脱壳，仅输出 T1 元信息"
    cat >&2 <<EOF
========================================
⚠ 加固 $PACKER - 策略=manual，需手动脱壳
========================================

方案 1: BlackDex（推荐）- https://github.com/CodingGay/BlackDex
方案 2: FART（需刷机）- 最完整
方案 3: frida-dexdump - pip3 install frida-dexdump

脱壳后继续:
  bash $SKILL_DIR/scripts/lib/decompile.sh $WORKDIR $APK --unpacked-dex-dir <dex目录>
  bash $SKILL_DIR/scripts/render.sh $WORKDIR
EOF
    decision_log "$WORKDIR" "加固 packer=$PACKER 策略=manual, T1-only 模式"
    # 输出 T1 元信息后退出，但不丢弃已有数据
    log "===== 完成（T1-only, 加固不可自动脱壳） ====="
    echo ""
    echo "$WORKDIR"
    exit 2
  fi

  # 可自动脱壳: 调用 unpack.sh
  log "===== 自动脱壳 ====="
  bash "$SKILL_DIR/scripts/lib/unpack.sh" "$APK" "$WORKDIR" "$PKG" "$PACKER" 2>&1 | tee -a "$WORKDIR/unpack.log"

  if [ ! -f "$WORKDIR/unpack_result.json" ]; then
    warn "unpack.sh 未输出 unpack_result.json，降级为 manual"
    decision_log "$WORKDIR" "脱壳结果文件缺失，降级 manual"
    echo ""
    echo "$WORKDIR"
    exit 2
  fi

  UNPACK_STRATEGY=$(json_get "$WORKDIR/unpack_result.json" .strategy)
  UNPACK_DEX_DIR=$(json_get "$WORKDIR/unpack_result.json" .unpacked_dex_dir)
  UNPACK_DEX_COUNT=$(json_get "$WORKDIR/unpack_result.json" .dex_count 0)

  if [ "$UNPACK_STRATEGY" = "manual" ] || [ "$UNPACK_DEX_COUNT" -eq 0 ]; then
    warn "自动脱壳失败，仅输出 T1 元信息"
    decision_log "$WORKDIR" "自动脱壳失败 (strategy=$UNPACK_STRATEGY dex=$UNPACK_DEX_COUNT), T1-only"
    echo ""
    echo "$WORKDIR"
    exit 2
  fi

  # 脱壳成功: 用脱壳后的 dex 继续反编译
  ok "✅ 脱壳成功: $UNPACK_DEX_COUNT dex (strategy=$UNPACK_STRATEGY)"
  DECOMPILE_EXTRA_ARGS="--unpacked-dex-dir $UNPACK_DEX_DIR"
fi

# ============================================================
# 3. decompile (可跳过 / resume)
# ============================================================
if [ "$SKIP_DECOMPILE" -eq 1 ]; then
  log "===== 跳过 decompile (--skip-decompile) ====="
else
  DECOMPILE_CMD="$SKILL_DIR/scripts/lib/decompile.sh $WORKDIR $DECOMPILE_INPUT"
  [ -n "$TASK" ] && DECOMPILE_CMD="$DECOMPILE_CMD --task $TASK"
  [ -n "$VENDOR" ] && DECOMPILE_CMD="$DECOMPILE_CMD --vendor $VENDOR"
  [ "$TOP_N" -gt 0 ] && DECOMPILE_CMD="$DECOMPILE_CMD --top-n $TOP_N"
  [ -n "$DECOMPILE_EXTRA_ARGS" ] && DECOMPILE_CMD="$DECOMPILE_CMD $DECOMPILE_EXTRA_ARGS"

  log "===== decompile (task=${TASK:-all} vendor=${VENDOR:-auto}) ====="
  $DECOMPILE_CMD 2>&1 | tee -a "$WORKDIR/decompile.log" | tail -5

  # 零产出警告
  JAVA_TOTAL=$(find "$WORKDIR/decompiled" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$JAVA_TOTAL" -eq 0 ]; then
    warn "⚠ jadx 产出 0 个 Java 文件 - 静态 grep 将跳过"
    DECOMPILE_MODE=$(cat "$WORKDIR/.decompile_mode" 2>/dev/null || echo "none")
    if [ "$DECOMPILE_MODE" = "smali" ]; then
      warn "已降级到 baksmali (smali 可读性差但可用于 grep)"
    else
      warn "建议: 检查 jadx 日志 ($WORKDIR/decompile.log) 或使用 --top-n 减少反编译数量"
    fi
    decision_log "$WORKDIR" "jadx 产出 0 Java files, decompile_mode=$DECOMPILE_MODE"
  fi
fi

# ============================================================
# 4. 静态 grep -> static_findings.json（同时支持 smali）
# ============================================================
log "===== 静态 grep ====="
DECOMPILE_MODE=$(cat "$WORKDIR/.decompile_mode" 2>/dev/null || echo "java")
python3 - "$SKILL_DIR/config.json" "$WORKDIR" "$DECOMPILE_MODE" "$VENDOR" <<'PYEOF' > "$WORKDIR/static_findings.json"
import sys, json, os, subprocess

cfg_path, workdir, decompile_mode = sys.argv[1], sys.argv[2], sys.argv[3]
vendor = sys.argv[4] if len(sys.argv) > 4 else ""
cfg = json.load(open(cfg_path))
patterns = cfg.get('static_grep_patterns', {})

# 如果指定了 vendor，合并 vendor 特定关键字
if vendor and vendor in cfg.get('vendor_profiles', {}):
    vp = cfg['vendor_profiles'][vendor]
    extra_class = vp.get('string_keywords', [])
    for kw in extra_class:
        if 'rpc_endpoints' not in patterns:
            patterns['rpc_endpoints'] = {'pattern': '', 'count': 0, 'sample': []}
        # 将 vendor 特定关键字合并到 rpc_endpoints 的搜索范围

# 确定搜索目录
if decompile_mode == 'smali':
    search_dir = os.path.join(workdir, 'smali')
    file_pattern = '*.smali'
else:
    search_dir = os.path.join(workdir, 'decompiled')
    file_pattern = '*.java'

findings = {}
if os.path.isdir(search_dir):
    for label, pat in patterns.items():
        if label.startswith('_'):
            continue
        try:
            r = subprocess.run(['grep', '-rEoh', '--include=' + file_pattern, pat, search_dir],
                               capture_output=True, text=True, timeout=300)
            matches = sorted(set(r.stdout.splitlines()))
        except Exception:
            matches = []
        findings[label] = {
            'pattern': pat,
            'count': len(matches),
            'sample': matches[:50],
            'source': 'smali' if decompile_mode == 'smali' else 'java',
        }

    # 额外: 如果有 smali 目录且 java 也是空的，grep smali 作为补充
    smali_dir = os.path.join(workdir, 'smali')
    if decompile_mode != 'smali' and os.path.isdir(smali_dir):
        java_count = sum(len(v.get('sample', [])) for v in findings.values() if isinstance(v, dict))
        if java_count == 0:
            for label, pat in patterns.items():
                if label.startswith('_'):
                    continue
                try:
                    r = subprocess.run(['grep', '-rEoh', '--include=*.smali', pat, smali_dir],
                                       capture_output=True, text=True, timeout=300)
                    matches = sorted(set(r.stdout.splitlines()))
                    if len(matches) > 0:
                        findings[label + '_smali'] = {
                            'pattern': pat,
                            'count': len(matches),
                            'sample': matches[:50],
                            'source': 'smali_fallback',
                        }
                except Exception:
                    pass
else:
    # 没有反编译目录，用 strings 扫原始 dex
    dex_dir = os.path.join(workdir, 'dex')
    if os.path.isdir(dex_dir):
        for label, pat in patterns.items():
            if label.startswith('_'):
                continue
            try:
                r = subprocess.run(['grep', '-rEoh', pat, dex_dir],
                                   capture_output=True, text=True, timeout=300)
                matches = sorted(set(r.stdout.splitlines()))
            except Exception:
                matches = []
            findings[label] = {
                'pattern': pat,
                'count': len(matches),
                'sample': matches[:50],
                'source': 'dex_strings',
            }
    else:
        findings['_skipped'] = 'no decompiled dir and no dex dir'

json.dump(findings, sys.stdout, ensure_ascii=False, indent=2)
PYEOF

# ============================================================
# 5. 汇总输出（最后一行是 workdir 路径，供 caller 解析）
# ============================================================
log "===== 完成 ====="
log "meta.json:          $(wc -c < "$WORKDIR/meta.json") bytes"
log "runtime_mods.json:  $(json_get "$WORKDIR/runtime_mods.json" .impact_on_static_analysis)"
[ -f "$WORKDIR/class_index.json" ] && log "class_index.json:   $(json_get "$WORKDIR/class_index.json" .total_classes) classes / $(json_get "$WORKDIR/class_index.json" .dex_count) dex"
[ -d "$WORKDIR/decompiled" ] && log "decompiled:         $(find "$WORKDIR/decompiled" -name '*.java' 2>/dev/null | wc -l | tr -d ' ') Java files"
[ -d "$WORKDIR/smali" ] && log "smali:              $(find "$WORKDIR/smali" -name '*.smali' 2>/dev/null | wc -l | tr -d ' ') smali files"
log "static_findings:    $(python3 -c "import json; f=json.load(open('$WORKDIR/static_findings.json')); print(', '.join(f'{k}={v[\"count\"]}' for k,v in f.items() if isinstance(v, dict)))")"

# 加固信息
if [ -f "$WORKDIR/unpack_result.json" ]; then
  log "packer:             $(json_get "$WORKDIR/unpack_result.json" .packer) -> $(json_get "$WORKDIR/unpack_result.json" .strategy) ($(json_get "$WORKDIR/unpack_result.json" .dex_count) dex)"
fi

decision_log "$WORKDIR" "analyze.sh 完成"

echo ""
echo "$WORKDIR"
