#!/bin/bash
# decompile.sh - 类索引 + 智能筛选 dex + jadx 反编译 + 零产出检测 + baksmali 降级
# 用法: decompile.sh <workdir> <apk_or_dex_dir> [--task <task>] [--top-n <N>] [--unpacked-dex-dir <dir>]
# 输入: workdir 已有 meta.json, runtime_mods.json
# 输出: workdir/class_index.json + workdir/all_classes.txt + workdir/decompiled/

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$SKILL_DIR/scripts/lib/_common.sh"

# ============================================================================
# 参数解析
# ============================================================================
WORKDIR=""
APK=""
TASK=""
TOP_N=0        # 0 = 不限制
UNPACKED_DIR="" # 脱壳后的 dex 目录

while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift 2 ;;
    --top-n) TOP_N="$2"; shift 2 ;;
    --unpacked-dex-dir) UNPACKED_DIR="$2"; shift 2 ;;
    --help|-h)
      cat <<EOF
用法: decompile.sh <workdir> <apk> [--task <task>] [--top-n <N>] [--unpacked-dex-dir <dir>]

参数:
  --task <task>              按 task 关键字筛选 dex（来自 config.json）
  --top-n <N>                限制最多反编译 N 个 dex（大 APK 用）
  --unpacked-dex-dir <dir>   使用脱壳后的 dex 目录（替代 APK 内的 dex）
EOF
      exit 0
      ;;
    *)
      if [ -z "$WORKDIR" ]; then WORKDIR="$1"
      elif [ -z "$APK" ]; then APK="$1"
      else die "未知参数: $1"; fi
      shift ;;
  esac
done

[ -z "$WORKDIR" ] && die "用法: decompile.sh <workdir> <apk>"
[ -z "$APK" ] && die "用法: decompile.sh <workdir> <apk>"
[ -d "$WORKDIR" ] || die "workdir not found: $WORKDIR"

# ============================================================================
# Resume: 如果已有有效的 class_index.json + decompiled/，跳过
# ============================================================================
if [ -f "$WORKDIR/class_index.json" ]; then
  EXISTING_JAVA=$(find "$WORKDIR/decompiled" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$EXISTING_JAVA" -gt 100 ]; then
    log "√ decompile 已完成（$EXISTING_JAVA Java files），跳过"
    echo "$EXISTING_JAVA"
    exit 0
  fi
fi

JADX=$(find_tool jadx)
BAKSMALI=$(find_tool baksmali)

# ============================================================================
# Step 1: 获取 dex 文件
# ============================================================================
if [ -n "$UNPACKED_DIR" ] && [ -d "$UNPACKED_DIR" ]; then
  # 使用脱壳后的 dex
  log "使用脱壳 dex: $UNPACKED_DIR"
  mkdir -p "$WORKDIR/dex"
  # 复制脱壳 dex 到工作目录（可能有子目录如 r2/）
  find "$UNPACKED_DIR" -name "*.dex" -exec cp {} "$WORKDIR/dex/" \;
  # 也可能直接就是 APK 文件（frida-dexdump 有时输出为 APK）
  if [ "$(ls "$WORKDIR/dex"/*.dex 2>/dev/null | wc -l | tr -d ' ')" -eq 0 ]; then
    # 尝试从脱壳 APK 中提取
    find "$UNPACKED_DIR" -name "*.apk" -exec unzip -o {} 'classes*.dex' -d "$WORKDIR/dex/" \; 2>/dev/null
  fi
else
  # 从 APK 中解压
  log "解压 dex..."
  mkdir -p "$WORKDIR/dex"
  unzip -o "$APK" 'classes*.dex' -d "$WORKDIR/dex" 2>&1 | tail -2
fi

DEX_COUNT=$(ls "$WORKDIR/dex"/*.dex 2>/dev/null | wc -l | tr -d ' ')
log "共 $DEX_COUNT 个 dex"

if [ "$DEX_COUNT" -eq 0 ]; then
  die "未找到任何 dex 文件"
fi

# ============================================================================
# Step 2: 建类名索引（用 strings 快速扫描，比 baksmali --list-classes 快）
# ============================================================================
log "建类名索引..."
INDEX_TMP="$WORKDIR/_class_index_raw.txt"
> "$INDEX_TMP"
for d in "$WORKDIR/dex"/*.dex; do
  [ -f "$d" ] || continue
  name=$(basename "$d")
  strings "$d" 2>/dev/null \
    | grep -oE '^L[a-zA-Z][a-zA-Z0-9_/$]+;$' \
    | sed 's/^L//;s/;$//;s#/#.#g' \
    | awk -v dx="$name" '{print dx"\t"$0}'
done > "$INDEX_TMP"
INDEX_LINES=$(wc -l < "$INDEX_TMP")
log "索引 $INDEX_LINES 行（类名->dex）"

# 写 class_index.json + all_classes.txt
python3 - "$INDEX_TMP" "$WORKDIR/class_index.json" <<'PYEOF'
import sys, json, os
from collections import defaultdict
src, dst = sys.argv[1], sys.argv[2]
by_dex = defaultdict(list)
all_cls = []
with open(src) as f:
    for ln in f:
        parts = ln.rstrip('\n').split('\t', 1)
        if len(parts) != 2: continue
        by_dex[parts[0]].append(parts[1])
        all_cls.append(parts[1])
out = {
    'total_classes': len(all_cls),
    'dex_count': len(by_dex),
    'classes_per_dex': {k: len(v) for k, v in sorted(by_dex.items())},
}
json.dump(out, open(dst, 'w'), ensure_ascii=False, indent=2)
# 全量类名列表（给 grep 用）
with open(os.path.join(os.path.dirname(dst), 'all_classes.txt'), 'w') as f:
    for cls in all_cls:
        f.write(cls + '\n')
PYEOF
rm -f "$INDEX_TMP"

# ============================================================================
# Step 3: 智能筛选 dex（基于类名索引，而非 strings 扫文件）
# 优先级: task 关键字 > top-N 最大 dex > 全部
# ============================================================================
PICK_DEX=()
if [ -n "$TASK" ]; then
  log "按 task=$TASK 筛选 dex（基于类名索引）..."
  # 从 config.json 获取关键字
  KEYWORDS=$(python3 - "$SKILL_DIR/config.json" "$TASK" <<'PYEOF'
import sys, json
cfg = json.load(open(sys.argv[1]))
task = sys.argv[2]
kw = cfg.get('task_keywords', {}).get(task, {})
all_kw = list(kw.get('class_keywords', [])) + list(kw.get('string_keywords', []))
print('|'.join(all_kw))
PYEOF
)
  if [ -n "$KEYWORDS" ]; then
    # 用 all_classes.txt 做精准匹配（比 strings 扫 dex 快得多）
    for d in "$WORKDIR/dex"/*.dex; do
      [ -f "$d" ] || continue
      name=$(basename "$d")
      # 在 class_index 中查找该 dex 的类列表
      match=$(python3 - "$WORKDIR/class_index.json" "$name" "$KEYWORDS" <<'PYEOF'
import sys, json, re
ci = json.load(open(sys.argv[1]))
dex_name = sys.argv[2]
kws = sys.argv[3].split('|')
patterns = [re.compile(kw, re.IGNORECASE) for kw in kws if kw]
# 检查 dex 文件名本身
for p in patterns:
    if p.search(dex_name):
        print("MATCH")
        sys.exit(0)
# 检查该 dex 的 strings（快速，只扫描当前 dex）
import subprocess
try:
    r = subprocess.run(['strings', dex_name], capture_output=True, text=True, timeout=30)
    for line in r.stdout.split('\n')[:5000]:  # 只看前 5000 行加速
        for p in patterns:
            if p.search(line):
                print("MATCH")
                sys.exit(0)
except:
    pass
print("NO_MATCH")
PYEOF
)
      if [ "$match" = "MATCH" ]; then
        PICK_DEX+=("$d")
      fi
    done
    log "命中关键字的 dex: ${#PICK_DEX[@]} / $DEX_COUNT"
  fi

  # 如果没命中任何 dex（关键字太窄），降级选主 dex + 最大 N 个
  if [ ${#PICK_DEX[@]} -eq 0 ]; then
    warn "task=$TASK 关键字未命中任何 dex，降级: 选 classes.dex + 最大的 3 个 dex"
    PICK_DEX=("$WORKDIR/dex/classes.dex")
    # 按大小降序取前 3 个（排除 classes.dex）
    for d in $(ls -S "$WORKDIR/dex"/*.dex 2>/dev/null | grep -v 'classes.dex$' | head -3); do
      PICK_DEX+=("$d")
    done
  fi
fi

# --top-n 限制
if [ "$TOP_N" -gt 0 ] && [ ${#PICK_DEX[@]} -gt "$TOP_N" ]; then
  log "按 --top-n $TOP_N 限制（从 ${#PICK_DEX[@]} 个 dex 中选最大的 $TOP_N 个）"
  # 按文件大小降序取 top N
  PICK_DEX=($(ls -S "${PICK_DEX[@]}" | head -"$TOP_N"))
fi

# 如果没指定 task 或 keyword 没命中，全部反编译
if [ ${#PICK_DEX[@]} -eq 0 ]; then
  PICK_DEX=("$WORKDIR/dex"/*.dex)
fi
log "最终选择 ${#PICK_DEX[@]} 个 dex 进行反编译"

# ============================================================================
# Step 4: jadx 反编译（并行，最多 4 进程）
# ============================================================================
log "jadx 反编译 ${#PICK_DEX[@]} 个 dex..."
mkdir -p "$WORKDIR/decompiled"

JADX_FAILED=()
PIDS=()
OUTS=()
MAX_PARALLEL=4
running=0

for d in "${PICK_DEX[@]}"; do
  [ -f "$d" ] || continue
  name=$(basename "$d" .dex)
  out="$WORKDIR/decompiled/$name"

  {
    if [ -n "$JADX" ]; then
      "$JADX" -d "$out" --no-imports --show-bad-code "$d" > "$WORKDIR/decompiled/$name.log" 2>&1
      JAVA_COUNT=$(find "$out/sources" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
      echo "  • $name jadx: $JAVA_COUNT Java files"
    else
      echo "  ▲ $name jadx 不可用"
    fi
  } &
  PIDS+=("$!")
  OUTS+=("$name")
  running=$((running + 1))
  if [ "$running" -ge "$MAX_PARALLEL" ]; then
    wait "${PIDS[0]}"
    PIDS=("${PIDS[@]:1}")
    OUTS=("${OUTS[@]:1}")
    running=$((running - 1))
  fi
done
# 等待所有完成
wait

# ============================================================================
# Step 5: 零产出检测 + baksmali 降级
# ============================================================================
JAVA_TOTAL=$(find "$WORKDIR/decompiled" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')

if [ "$JAVA_TOTAL" -eq 0 ]; then
  warn "jadx 产出 0 个 Java 文件！"
  decision_log "$WORKDIR" "jadx 产出为 0，尝试 baksmali 降级"

  if [ -n "$BAKSMALI" ]; then
    log "降级到 baksmali（smali 输出，比 Java 可读性差但至少有内容）..."
    mkdir -p "$WORKDIR/smali"
    SMALI_COUNT=0
    for d in "${PICK_DEX[@]}"; do
      [ -f "$d" ] || continue
      name=$(basename "$d" .dex)
      out="$WORKDIR/smali/$name"
      mkdir -p "$out"
      "$BAKSMALI" d -o "$out" "$d" 2>/dev/null
      local_count=$(find "$out" -name "*.smali" 2>/dev/null | wc -l | tr -d ' ')
      SMALI_COUNT=$((SMALI_COUNT + local_count))
    done
    if [ "$SMALI_COUNT" -gt 0 ]; then
      log "baksmali 产出 $SMALI_COUNT 个 smali 文件（降级模式）"
      decision_log "$WORKDIR" "baksmali 降级成功: $SMALI_COUNT smali files"
      # 创建一个标记文件让后续流程知道这是 smali 而非 java
      echo "smali" > "$WORKDIR/.decompile_mode"
    else
      warn "baksmali 也产出 0 - 用 grep 扫原始 dex strings 作为最后手段"
      decision_log "$WORKDIR" "jadx + baksmali 均产出为 0，仅有 strings 索引"
      echo "strings_only" > "$WORKDIR/.decompile_mode"
    fi
  else
    warn "baksmali 也不可用 - 仅有 strings 索引"
    decision_log "$WORKDIR" "jadx 产出为 0 且 baksmali 不可用，仅有 strings 索引"
    echo "strings_only" > "$WORKDIR/.decompile_mode"
  fi
else
  # 正常产出，清理降级模式标记
  rm -f "$WORKDIR/.decompile_mode"
fi

# 对每个 dex 检查 jadx 是否实际产出（并行情况下可能有部分失败）
for d in "${PICK_DEX[@]}"; do
  [ -f "$d" ] || continue
  name=$(basename "$d" .dex)
  out="$WORKDIR/decompiled/$name"
  if [ -d "$out" ]; then
    java_count=$(find "$out" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$java_count" -eq 0 ]; then
      JADX_FAILED+=("$name")
      # 检查 jadx log 是否有 OOM
      if grep -qi "OutOfMemoryError\|GC overhead\|heap space" "$WORKDIR/decompiled/$name.log" 2>/dev/null; then
        warn "$name: jadx OOM - 可用 --top-n 减少反编译数量或增加 JVM 内存"
        decision_log "$WORKDIR" "jadx OOM for $name"
      fi
    fi
  fi
done

if [ ${#JADX_FAILED[@]} -gt 0 ]; then
  warn "以下 dex 反编译失败（0 files）: ${JADX_FAILED[*]}"
  decision_log "$WORKDIR" "jadx 失败的 dex: ${JADX_FAILED[*]}"
fi

# ============================================================================
# Step 6: 汇总
# ============================================================================
JAVA_TOTAL=$(find "$WORKDIR/decompiled" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
SMALI_TOTAL=$(find "$WORKDIR/smali" -name "*.smali" 2>/dev/null | wc -l | tr -d ' ')
DECOMPILE_MODE=$(cat "$WORKDIR/.decompile_mode" 2>/dev/null || echo "java")

log "反编译完成: $JAVA_TOTAL Java + $SMALI_TOTAL smali -> $WORKDIR/decompiled/ (mode=$DECOMPILE_MODE)"
echo "$JAVA_TOTAL"
