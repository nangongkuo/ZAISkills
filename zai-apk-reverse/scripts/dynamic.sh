#!/bin/bash
# dynamic.sh - v3 入口 2: 动态 hook 一轮
# 用法:
#   dynamic.sh <workdir> <round_id> [--task <task>] [--duration N] [--attach|--spawn] [extra_scripts...]
#
# 行为:
#   1. emu_helper keep-awake + screen 截图(before)
#   2. 根据 task 从 config.json 选 frida 脚本（或用 extra_scripts）
#   3. run_frida.py 跑 <duration>s（默认 60）
#   4. emu_helper screen 截图(after)
#   5. reassemble_body.py --all -> bodies/
#   6. 解析 log -> findings/round-N.json
#
# 输出: findings/round-N.json + evidence/screenshots/round-N-{before,after}.png + evidence/logs/round-N.log

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SKILL_DIR
source "$SKILL_DIR/scripts/lib/_common.sh"

# 参数
WORKDIR="${1:?用法: dynamic.sh <workdir> <round_id> [--task t] [--duration N] [--attach|--spawn] [extra.js...]}"
ROUND="${2:?用法: dynamic.sh <workdir> <round_id> ...}"
shift 2

TASK=""
VENDOR=""
DURATION=60
MODE="--attach"  # 默认 attach 已运行进程
EXTRA_SCRIPTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift 2 ;;
    --vendor) VENDOR="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --attach) MODE="--attach"; shift ;;
    --spawn) MODE="--spawn"; shift ;;
    *) EXTRA_SCRIPTS+=("$1"); shift ;;
  esac
done

[ -d "$WORKDIR" ] || die "workdir 不存在: $WORKDIR"
[ -f "$WORKDIR/meta.json" ] || die "缺 $WORKDIR/meta.json，先跑 analyze.sh"

PKG=$(json_get "$WORKDIR/meta.json" .package)
[ -z "$PKG" ] && die "解析包名失败"

# 若 task 未提供，从 .task 文件读
if [ -z "$TASK" ] && [ -f "$WORKDIR/.task" ]; then
  TASK=$(cat "$WORKDIR/.task")
fi

# 若 vendor 未提供，从 .vendor 文件读
if [ -z "$VENDOR" ] && [ -f "$WORKDIR/.vendor" ]; then
  VENDOR=$(cat "$WORKDIR/.vendor")
fi

# ============================================================
# 环境校验（adb + frida 版本）
# ============================================================
log "===== 环境校验 ====="
check_device

# ============================================================
# 选脚本（config.json + vendor profile + anti_detect）
# ============================================================
# 基础脚本始终加载（按 config.json frida.script_load_order 或默认顺序）
BASE_SCRIPTS=("lib/_common.js" "lib/_anti_detect.js" "00_bootstrap.js")

# task 特定脚本
TASK_SCRIPTS=()
if [ ${#EXTRA_SCRIPTS[@]} -eq 0 ]; then
  if [ -n "$TASK" ]; then
    readarray -t TASK_SCRIPTS < <(python3 -c "
import json
cfg = json.load(open('$SKILL_DIR/config.json'))
scripts = cfg.get('task_keywords', {}).get('$TASK', {}).get('frida_scripts', [])
if not scripts:
    scripts = ['trace_mtop.js']
out = []
for s in scripts:
    if s in ('_common.js', '00_bootstrap.js', 'lib/_common.js'):
        continue  # 已在 BASE 中
    out.append(s)
for s in out: print(s)
")
  else
    warn "未指定 task，使用默认（trace_mtop）"
    TASK_SCRIPTS=("trace_mtop.js")
  fi
else
  TASK_SCRIPTS=("${EXTRA_SCRIPTS[@]}")
fi

# vendor 特定脚本（在 task 脚本之后加载）
VENDOR_SCRIPTS=()
if [ -n "$VENDOR" ]; then
  readarray -t VENDOR_SCRIPTS < <(python3 -c "
import json
cfg = json.load(open('$SKILL_DIR/config.json'))
vp = cfg.get('vendor_profiles', {}).get('$VENDOR', {})
scripts = vp.get('frida_scripts', [])
for s in scripts: print(s)
" 2>/dev/null || true)
fi

# 合并所有脚本（去重）
ALL_SCRIPTS=("${BASE_SCRIPTS[@]}")
for s in "${TASK_SCRIPTS[@]}" "${VENDOR_SCRIPTS[@]}"; do
  # _common.js 和 00_bootstrap.js 已在 BASE 中，跳过
  case "$s" in
    _common.js|00_bootstrap.js|lib/_common.js) continue ;;
  esac
  ALL_SCRIPTS+=("$s")
done

log "===== Dynamic round=$ROUND task=${TASK:-?} vendor=${VENDOR:-auto} pkg=$PKG ====="
log "脚本: ${ALL_SCRIPTS[*]}"
log "模式: $MODE 时长: ${DURATION}s"

# 1. emu 唤醒 + before 截图
ADB=$(find_tool adb)
if [ -n "$ADB" ]; then
  $ADB shell svc power stayon true 2>/dev/null
  $ADB shell input keyevent KEYCODE_WAKEUP 2>/dev/null
  $ADB exec-out screencap -p > "$WORKDIR/evidence/screenshots/round-${ROUND}-before.png" 2>/dev/null
  log "已唤醒屏幕 + 截图 before"
fi

# 2. 构造脚本绝对路径
SCRIPT_ARGS=()
for s in "${ALL_SCRIPTS[@]}"; do
  if [ -f "$SKILL_DIR/scripts/frida/$s" ]; then
    SCRIPT_ARGS+=("$SKILL_DIR/scripts/frida/$s")
  elif [ -f "$s" ]; then
    SCRIPT_ARGS+=("$s")
  else
    warn "脚本不存在: $s（跳过）"
  fi
done

# 3. run_frida
LOG="$WORKDIR/evidence/logs/round-${ROUND}.log"
PYTHON=$(find_tool python3)
RUN_FRIDA="$SKILL_DIR/scripts/lib/run_frida.py"

log "启动 frida（输出 $LOG）..."
RUN_ARGS=()
[ "$MODE" = "--spawn" ] && RUN_ARGS+=(--spawn)
RUN_ARGS+=(--duration "$DURATION" --out "$LOG" "$PKG")
RUN_ARGS+=("${SCRIPT_ARGS[@]}")

# 让 frida 在 PATH 中（避免 python frida lib 找不到 frida-tools）
export PATH="$(dirname "$(find_tool frida)"):$PATH"
"$PYTHON" "$RUN_FRIDA" "${RUN_ARGS[@]}" &
FPID=$!
log "frida pid=$FPID"

# 等用户在 emu 上做操作（duration 自然结束）
wait $FPID 2>/dev/null
RC=$?
log "frida 结束 rc=$RC, log $(wc -l < "$LOG" 2>/dev/null) lines"

# 4. after 截图
if [ -n "$ADB" ]; then
  $ADB exec-out screencap -p > "$WORKDIR/evidence/screenshots/round-${ROUND}-after.png" 2>/dev/null
  TOP_ACT=$($ADB shell dumpsys activity activities 2>/dev/null | grep topResumedActivity | head -1 | grep -oE '[a-zA-Z][a-zA-Z0-9_.]+/[a-zA-Z0-9_.$]+' | head -1)
  log "after 截图完成. topActivity=$TOP_ACT"
fi

# 5. 拼接大响应
BODIES_DIR="$WORKDIR/evidence/bodies/round-$ROUND"
mkdir -p "$BODIES_DIR"
"$PYTHON" "$SKILL_DIR/scripts/lib/reassemble_body.py" "$LOG" --all "$BODIES_DIR" 2>/dev/null || true
BODIES_COUNT=$(ls "$BODIES_DIR" 2>/dev/null | wc -l | tr -d ' ')
log "拼接 $BODIES_COUNT 个 body 文件 -> $BODIES_DIR"

# 6. 结构化 findings
FINDINGS="$WORKDIR/findings/round-${ROUND}.json"
"$PYTHON" - "$LOG" "$ROUND" "${TASK:-}" "${TOP_ACT:-unknown}" "$BODIES_DIR" "$FINDINGS" << 'PYEOF'
import sys, json, re, os
from collections import defaultdict

log_path, round_id, task, top_act, bodies_dir, out_path = sys.argv[1:7]

if not os.path.exists(log_path):
    print(json.dumps({"error": "log not found"}), file=sys.stderr)
    sys.exit(1)

text = open(log_path, encoding='utf-8', errors='replace').read()

# 1. URL 列表（mtop / anet）
urls = set()
for m in re.finditer(r'(?:\[anet\]|\[WV\.loadUrl\]|\[UC\.loadUrl\])\s*(https?://[^\s\'"]+)', text):
    urls.add(m.group(1))

# 2. mtop API + 请求体路径
requests = []
for m in re.finditer(r'REQ\s+#(\d+)\s+api=([\w.]+)\s+v=([\d.]+)', text):
    seq = int(m.group(1))
    requests.append({'seq': seq, 'api': m.group(2), 'version': m.group(3)})

# 3. 响应
responses = []
for m in re.finditer(r'RESP\s+#(\d+)\s+api=([\w.]+)\s+v=([\d.]+)\s+size=(\d+)', text):
    seq = int(m.group(1))
    api = m.group(2)
    body_path = None
    # 看 bodies/ 里是否有对应文件（label 是 "RESP#N.body" -> 文件名安全化）
    cand = os.path.join(bodies_dir, f'RESP#{seq}.body.txt')
    if os.path.exists(cand): body_path = cand
    # 兼容命名
    for f in os.listdir(bodies_dir) if os.path.isdir(bodies_dir) else []:
        if f.startswith(f'RESP') and (str(seq) in f) and ('body' in f):
            body_path = os.path.join(bodies_dir, f)
            break
    responses.append({'seq': seq, 'api': api, 'version': m.group(3),
                      'size': int(m.group(4)), 'body_path': body_path})

# 4. Activity 跳转
activities_started = []
for m in re.finditer(r'\[startActivity\]\s+([\w.$]+)\s+data=([^\n]+)', text):
    activities_started.append({'class': m.group(1), 'data': m.group(2).strip()})

# 5. so 加载
so_loaded = sorted(set(re.findall(r'\[loadLibrary\]\s+(\w+)', text)))

# 6. hooks_hit 概况
hook_lines = [ln for ln in text.split('\n') if '[OK]' in ln or '[hook]' in ln]

# 截图
screenshots = []
ws = os.path.dirname(os.path.dirname(bodies_dir))  # ../..
sd = os.path.join(ws, 'screenshots')
for name in ['before', 'after']:
    p = os.path.join(sd, f'round-{round_id}-{name}.png')
    if os.path.exists(p): screenshots.append(p)

out = {
    "round_id": round_id,
    "task": task,
    "top_activity_after": top_act,
    "log_path": log_path,
    "log_lines": len(text.split('\n')),
    "urls": sorted(urls),
    "requests": requests,
    "responses": responses,
    "activities_started": activities_started,
    "so_loaded": so_loaded,
    "hooks_setup_count": len(hook_lines),
    "screenshots": screenshots,
}

json.dump(out, open(out_path, 'w'), ensure_ascii=False, indent=2)
print(f"[+] findings written: {out_path}")
print(f"    urls:{len(urls)} req:{len(requests)} resp:{len(responses)} act:{len(activities_started)} so:{len(so_loaded)}")
PYEOF

decision_log "$WORKDIR" "Round $ROUND 完成 (task=$TASK, log=$LOG)"
log "===== Round $ROUND 完成 ====="
echo ""
echo "$FINDINGS"
