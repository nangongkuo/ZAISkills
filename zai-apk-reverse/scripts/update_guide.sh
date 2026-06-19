#!/bin/bash
# update_guide.sh - 把本地 GUIDE.md 推到语雀（幂等：每次都 update 同一 slug）
# 用法：update_guide.sh [--guide <path>]
#
# 默认从 ~/.apk-reverse/GUIDE.md 推到 lingxi.mly/dbqqab/glzq7t1sg6da501g

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SKILL_DIR/scripts/lib/_common.sh"

GUIDE="${HOME}/.apk-reverse/GUIDE.md"
while [ $# -gt 0 ]; do
    case "$1" in
        --guide) GUIDE="$2"; shift 2 ;;
        *) die "未知参数：$1" ;;
    esac
done

[ -f "$GUIDE" ] || die "GUIDE.md 不存在：$GUIDE"

YUQUE=$(find_tool yuque) || die "yuque CLI 未找到"

# 读 state
STATE="$HOME/.apk-reverse/state/_guide.json"
if [ ! -f "$STATE" ]; then
    die "$STATE 不存在，首次发布请用 yuque create doc 然后把 slug 写入"
fi

NS=$(json_get "$STATE" .guide.namespace)
SLUG=$(json_get "$STATE" .guide.slug)
[ -z "$NS" ] || [ -z "$SLUG" ] && die "state 中 namespace 或 slug 为空"

log "更新指南 $NS/$SLUG ..."
$YUQUE update doc "$NS/$SLUG" \
    --body-file "$GUIDE" \
    --json 2>&1 | tail -5

echo ""
log "完成"
echo "https://yuque.antfin.com/$NS/$SLUG"
