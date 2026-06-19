#!/bin/bash
# publish.sh - v3 入口 4: 把 report.md 发布到飞书文档（幂等：首次 create，后续 overwrite）
#
# 用法:
#   publish.sh <package> [--parent-token <token>] [--parent-position <pos>] [--no-feishu] [--as user|bot]
#
# 依赖:
#   - lark-cli 已配置并具备飞书文档权限
#   - render.sh 已经跑过，~/.apk-reverse/reports/<pkg>/report.md 存在
#
# 状态文件: ~/.apk-reverse/state/<pkg>.json
#   {"package":"...","feishu":{"parent_token":"...","document_id":"...","url":"..."}}

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SKILL_DIR
if [ -f "$SKILL_DIR/scripts/lib/_common.sh" ]; then
  source "$SKILL_DIR/scripts/lib/_common.sh"
else
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
fi

PKG="${1:?用法: publish.sh <package> [--parent-token token] [--parent-position pos] [--no-feishu] [--as user|bot]}"
shift

PARENT_TOKEN=""
PARENT_POSITION=""
NO_FEISHU=0
AS_IDENTITY="user"

while [ $# -gt 0 ]; do
  case "$1" in
    --parent-token) PARENT_TOKEN="${2:-}"; shift 2 ;;
    --parent-position) PARENT_POSITION="${2:-}"; shift 2 ;;
    --no-feishu) NO_FEISHU=1; shift ;;
    --as) AS_IDENTITY="${2:-}"; shift 2 ;;
    --namespace)
      die "--namespace 是旧语雀参数，已废弃；请改用 --parent-token <飞书文件夹token> 或 --parent-position <位置>"
      ;;
    --no-yuque)
      die "--no-yuque 是旧语雀参数，已废弃；请改用 --no-feishu"
      ;;
    *) die "未知参数: $1" ;;
  esac
done

REPORT="$REPORTS_ROOT/$PKG/report.md"
[ -f "$REPORT" ] || die "report.md 不存在: $REPORT (先跑 render.sh)"

if [ $NO_FEISHU -eq 1 ]; then
  log "--no-feishu 跳过"
  echo "$REPORT"
  exit 0
fi

case "$AS_IDENTITY" in
  user|bot) ;;
  *) die "--as 仅支持 user 或 bot" ;;
esac

if [ -n "$PARENT_TOKEN" ] && [ -n "$PARENT_POSITION" ]; then
  die "--parent-token 与 --parent-position 不能同时指定"
fi

LARK=$(find_tool lark-cli) || die "lark-cli 未找到。请先安装并配置 lark-cli"

# 默认发布位置来自 config.json；当前默认是用户指定的飞书 Drive 文件夹。
if [ -z "$PARENT_TOKEN" ] && [ -z "$PARENT_POSITION" ]; then
  PARENT_TOKEN=$(json_get "$SKILL_DIR/config.json" .feishu.default_parent_token)
  PARENT_POSITION=$(json_get "$SKILL_DIR/config.json" .feishu.default_parent_position)
fi

PARENT_ARGS=()
PARENT_DESC="我的空间根目录"
if [ -n "$PARENT_TOKEN" ]; then
  PARENT_ARGS=(--parent-token "$PARENT_TOKEN")
  PARENT_DESC="parent_token=$PARENT_TOKEN"
elif [ -n "$PARENT_POSITION" ]; then
  PARENT_ARGS=(--parent-position "$PARENT_POSITION")
  PARENT_DESC="parent_position=$PARENT_POSITION"
fi

# 查飞书文档状态；同一父位置才复用，避免把不同目录的发布串到同一个文档。
DOC_URL=$(state_get "$PKG" .feishu.url)
DOC_ID=$(state_get "$PKG" .feishu.document_id)
SAVED_PARENT_TOKEN=$(state_get "$PKG" .feishu.parent_token)
SAVED_PARENT_POSITION=$(state_get "$PKG" .feishu.parent_position)
DOC_TARGET="$DOC_URL"
[ -z "$DOC_TARGET" ] && DOC_TARGET="$DOC_ID"

SAME_PARENT=0
if [ -n "$PARENT_TOKEN" ] && [ "$SAVED_PARENT_TOKEN" = "$PARENT_TOKEN" ]; then
  SAME_PARENT=1
elif [ -n "$PARENT_POSITION" ] && [ "$SAVED_PARENT_POSITION" = "$PARENT_POSITION" ]; then
  SAME_PARENT=1
elif [ -z "$PARENT_TOKEN" ] && [ -z "$PARENT_POSITION" ] && \
  [ -z "$SAVED_PARENT_TOKEN" ] && [ -z "$SAVED_PARENT_POSITION" ]; then
  SAME_PARENT=1
fi

if [ -n "$DOC_TARGET" ] && [ $SAME_PARENT -eq 1 ]; then
  log "===== 更新已有飞书文档 $DOC_TARGET ====="
  RESULT=$("$LARK" docs +update \
    --api-version v2 \
    --as "$AS_IDENTITY" \
    --doc "$DOC_TARGET" \
    --command overwrite \
    --doc-format markdown \
    --content - \
    --json < "$REPORT" 2>&1)
  RC=$?
  URL="$DOC_URL"
  NEW_DOC_ID="$DOC_ID"
else
  log "===== 创建新飞书文档 in $PARENT_DESC ====="
  RESULT=$("$LARK" docs +create \
    --api-version v2 \
    --as "$AS_IDENTITY" \
    --doc-format markdown \
    "${PARENT_ARGS[@]}" \
    --content - \
    --json < "$REPORT" 2>&1)
  RC=$?
  URL=$(echo "$RESULT" | python3 -c "
import json, re, sys
text = sys.stdin.read()
try:
    data = json.loads(text)
    print(data.get('data', {}).get('document', {}).get('url', ''))
except Exception:
    m = re.findall(r'\"url\":\s*\"(https://[^\"]+)\"', text)
    print(m[-1] if m else '')
")
  NEW_DOC_ID=$(echo "$RESULT" | python3 -c "
import json, re, sys
text = sys.stdin.read()
try:
    data = json.loads(text)
    print(data.get('data', {}).get('document', {}).get('document_id', ''))
except Exception:
    m = re.findall(r'\"document_id\":\s*\"([^\"]+)\"', text)
    print(m[-1] if m else '')
")
fi

if [ $RC -ne 0 ]; then
  warn "lark-cli 返回非0，最后 8 行:"
  echo "$RESULT" | tail -8 >&2
  echo "$RESULT" | grep -q "auth login" && warn "可能需要先执行 lark-cli auth login 完成用户授权"
  exit $RC
fi

if [ -n "$NEW_DOC_ID" ]; then
  state_set "$PKG" .feishu.document_id "$NEW_DOC_ID"
fi
if [ -n "$URL" ]; then
  state_set "$PKG" .feishu.url "$URL"
fi
state_set "$PKG" .feishu.as "$AS_IDENTITY"
state_set "$PKG" .feishu.parent_token "$PARENT_TOKEN"
state_set "$PKG" .feishu.parent_position "$PARENT_POSITION"

log "===== 发布完成 ====="
log "target:      $PARENT_DESC"
log "document_id: ${NEW_DOC_ID:-$DOC_ID}"
echo ""
echo "$URL"
