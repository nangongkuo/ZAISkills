#!/bin/bash
# update_guide.sh - 把本地 GUIDE.md 同步到飞书文档（幂等：每次 overwrite 同一文档）
# 用法：update_guide.sh [--guide <path>] [--doc <url-or-token>] [--as user|bot]
#
# 默认从 ~/.apk-reverse/GUIDE.md 推到 ~/.apk-reverse/state/_guide.json 记录的 guide.feishu 文档。

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SKILL_DIR/scripts/lib/_common.sh"

GUIDE="${HOME}/.apk-reverse/GUIDE.md"
DOC=""
AS_IDENTITY="user"
while [ $# -gt 0 ]; do
    case "$1" in
        --guide) GUIDE="${2:-}"; shift 2 ;;
        --doc) DOC="${2:-}"; shift 2 ;;
        --as) AS_IDENTITY="${2:-}"; shift 2 ;;
        *) die "未知参数：$1" ;;
    esac
done

[ -f "$GUIDE" ] || die "GUIDE.md 不存在：$GUIDE"
case "$AS_IDENTITY" in
    user|bot) ;;
    *) die "--as 仅支持 user 或 bot" ;;
esac

LARK=$(find_tool lark-cli) || die "lark-cli 未找到。请先安装并配置 lark-cli"

STATE="$HOME/.apk-reverse/state/_guide.json"
if [ -z "$DOC" ]; then
    if [ ! -f "$STATE" ]; then
        die "$STATE 不存在；首次发布请先用 lark-cli docs +create 创建飞书文档，并写入 guide.feishu.url 或 guide.feishu.document_id"
    fi
    DOC=$(json_get "$STATE" .guide.feishu.url)
    [ -z "$DOC" ] && DOC=$(json_get "$STATE" .guide.feishu.document_id)
fi
[ -z "$DOC" ] && die "未指定飞书文档；请传 --doc 或在 state 中写入 guide.feishu.url/document_id"

log "更新飞书指南 $DOC ..."
RESULT=$("$LARK" docs +update \
    --api-version v2 \
    --as "$AS_IDENTITY" \
    --doc "$DOC" \
    --command overwrite \
    --doc-format markdown \
    --content - \
    --json < "$GUIDE" 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
    warn "lark-cli 返回非0，最后 8 行:"
    echo "$RESULT" | tail -8 >&2
    echo "$RESULT" | grep -q "auth login" && warn "可能需要先执行 lark-cli auth login 完成用户授权"
    exit $RC
fi

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

log "完成"
echo "${URL:-$DOC}"
