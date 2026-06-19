#!/bin/bash
# publish.sh - v3 入口 4: 把 report.md 推到语雀（幂等：首次 create，后续 update）
#
# 用法:
#   publish.sh <package> [--namespace <ns>] [--no-yuque]
#
# 依赖:
#   - yuque CLI 已装且 whoami OK
#   - render.sh 已经跑过，~/.apk-reverse/reports/<pkg>/report.md 存在
#
# 状态文件: ~/.apk-reverse/state/<pkg>.json
#   {"package":"...","yuque":{"namespace":"...","slug":"..."}}

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SKILL_DIR
if [ -f "$SKILL_DIR/scripts/lib/_common.sh" ]; then
  source "$SKILL_DIR/scripts/lib/_common.sh"
else
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
fi

PKG="${1:?用法: publish.sh <package> [--namespace ns] [--no-yuque]}"
shift
NAMESPACE=""
NO_YUQUE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --no-yuque) NO_YUQUE=1; shift ;;
    *) die "未知参数: $1" ;;
  esac
done

REPORT="$REPORTS_ROOT/$PKG/report.md"
[ -f "$REPORT" ] || die "report.md 不存在: $REPORT (先跑 render.sh)"

if [ $NO_YUQUE -eq 1 ]; then
  log "--no-yuque 跳过"
  echo "$REPORT"
  exit 0
fi

YUQUE=$(find_tool yuque) || die "yuque CLI 未找到。装: npm i -g @antcli/yuque-ant-cli"

# 默认 namespace 来自 config.json
if [ -z "$NAMESPACE" ]; then
  NAMESPACE=$(json_get "$SKILL_DIR/config.json" .yuque.default_namespace)
fi
[ -z "$NAMESPACE" ] && die "未指定 namespace 且 config.json 无默认值"

# 验证登录
if ! $YUQUE whoami --json 2>&1 | grep -q '"login"'; then
  die "yuque 未登录，先跑: yuque whoami"
fi

# 查 slug
SLUG=$(state_get "$PKG" .yuque.slug)
SAVED_NS=$(state_get "$PKG" .yuque.namespace)

# 标题
VER=$(json_get "$REPORTS_ROOT/$PKG/meta.json" .version_name)
NICE_NAME=$(echo "$PKG" | awk -F. '{print toupper(substr($NF,1,1)) substr($NF,2)}')
TITLE="[APK 逆向] $NICE_NAME $VER"

# 决策: create or update
if [ -n "$SLUG" ] && [ "$SAVED_NS" = "$NAMESPACE" ]; then
  log "===== 更新已有文档 $NAMESPACE/$SLUG ====="
  RESULT=$($YUQUE update doc "$NAMESPACE/$SLUG" \
    --body-file "$REPORT" \
    --upload-images --yes \
    --json 2>&1)
  RC=$?
else
  log "===== 创建新文档 in $NAMESPACE ====="
  RESULT=$($YUQUE create doc \
    --namespace "$NAMESPACE" \
    --title "$TITLE" \
    --body-file "$REPORT" \
    --upload-images --yes \
    --json 2>&1)
  RC=$?
fi

if [ $RC -ne 0 ]; then
  warn "yuque 返回非0，最后 5 行:"
  echo "$RESULT" | tail -5 >&2
  exit $RC
fi

# 解析 slug + url
NEW_SLUG=$(echo "$RESULT" | python3 -c "
import sys, json, re
text = sys.stdin.read()
# 找 url 形如 https://yuque.antfin.com/go/doc/<id>, 取这个 id 然后 resolve
# 但更准确: 从 JSON 找 'slug' 且其旁边有 'doc_id' 或 'type'=='Doc'
m = re.search(r'\"slug\":\s*\"([^\"]+)\"\s*,\s*\"book_id\"', text)
if not m:
    # 退回找最后一个 slug（命中 doc 的最可能）
    candidates = re.findall(r'\"slug\":\s*\"([a-z0-9]{6,32})\"', text)
    # 过滤掉 namespace 段
    candidates = [c for c in candidates if c not in ('$NAMESPACE'.split('/')[1] if '/' in '$NAMESPACE' else '',)]
    print(candidates[-1] if candidates else '')
else:
    print(m.group(1))
")
URL=$(echo "$RESULT" | python3 -c "
import sys, re
text = sys.stdin.read()
m = re.findall(r'\"url\":\s*\"(https://[^\"]+/doc/[0-9]+)\"', text)
if not m:
    m = re.findall(r'\"url\":\s*\"(https://[^\"]+)\"', text)
print(m[-1] if m else '')
")

if [ -n "$NEW_SLUG" ]; then
  state_set "$PKG" .yuque.namespace "$NAMESPACE"
  state_set "$PKG" .yuque.slug "$NEW_SLUG"
  ok "状态已保存: slug=$NEW_SLUG"
fi

log "===== 发布完成 ====="
log "namespace: $NAMESPACE"
log "slug:      $NEW_SLUG"
log "title:     $TITLE"
echo ""
echo "$URL"
