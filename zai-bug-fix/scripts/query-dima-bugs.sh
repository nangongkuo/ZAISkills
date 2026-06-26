#!/usr/bin/env bash
# query-dima-bugs.sh
# 查询 Dima 缺陷 (Bug) 列表的封装脚本，基于 `dima bug list` 命令
# 用法: ./query-dima-bugs.sh [options]

set -euo pipefail

# 获取当前登录用户的 Staff ID（工号，用于自动过滤）
get_current_user() {
  dima auth me 2>/dev/null | grep -i "Staff ID:" | awk -F':' '{print $2}' | tr -d ' \r\n'
}

# 获取当前用户参与的所有空间ID列表
get_user_spaces() {
  dima space list --member -o json 2>/dev/null | grep -o '"workspaceId":"[^"]*"' | cut -d'"' -f4
}

PROJECT_ID=""
SPACE_ID=""
PROCESSOR=""
STATUS_LIST=""
STATUS_ALL=false
SPRINT_ID=""
TAG=""
PRIORITY=""
SCOPE=""
FILTER=""
PAGE=""
PAGE_SIZE=""
ALL=false
GET_ID=""
OUTPUT="table"

usage() {
  cat <<'EOF'
用法: query-dima-bugs.sh [options]

通用参数:
  -p, --project <id>        项目 ID (P 开头)
  -s, --space <id>          空间 ID (W 开头)
  -o, --output <fmt>        输出格式: table | json | markdown (默认: table)

查询单个缺陷:
  -i, --id <workitemId>     指定缺陷 ID，走 `dima bug get` 路径

列表过滤:
    --processor <ids>       处理人工号或花名（逗号分隔多人）
    --status <list>         状态名称或 ID 列表，逗号分隔（例："待处理,进行中"）
    --status-all            查询所有状态（默认仅返回 待开始/进行中）
    --sprint <id>           迭代 ID
    --tag <name>            标签名称或 ID，多个用逗号分隔
    --priority <id>         优先级 ID（94紧急 / 95高 / 96中 / 97低）
    --scope <scope>         查询范围: all/personal/associate/child/...
    --filter <expr>         自定义过滤表达式，例如 "subject~登录"

分页:
    --page <n>              页码
    --page-size <n>         每页条数
    --all                   自动分页拉取全部

其他:
  -h, --help                显示本帮助

示例:
  # 查询某项目下当前活跃的 bug
  ./query-dima-bugs.sh -p P123456

  # 查询某迭代中分配给某人的高优 bug
  ./query-dima-bugs.sh -p P123456 --sprint SPRINT-xxx --processor zhangsan --priority 95

  # 标题模糊匹配
  ./query-dima-bugs.sh -s W12345 --filter "subject~登录" -o json

  # 查看单个 bug 详情（含自定义字段）
  ./query-dima-bugs.sh -i WI-1234567
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project)   PROJECT_ID="$2"; shift 2 ;;
    -s|--space)     SPACE_ID="$2"; shift 2 ;;
    -o|--output)    OUTPUT="$2"; shift 2 ;;
    -i|--id)        GET_ID="$2"; shift 2 ;;
    --processor)    PROCESSOR="$2"; shift 2 ;;
    --status)       STATUS_LIST="$2"; shift 2 ;;
    --status-all)   STATUS_ALL=true; shift ;;
    --sprint)       SPRINT_ID="$2"; shift 2 ;;
    --tag)          TAG="$2"; shift 2 ;;
    --priority)     PRIORITY="$2"; shift 2 ;;
    --scope)        SCOPE="$2"; shift 2 ;;
    --filter)       FILTER="$2"; shift 2 ;;
    --page)         PAGE="$2"; shift 2 ;;
    --page-size)    PAGE_SIZE="$2"; shift 2 ;;
    --all)          ALL=true; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

if ! command -v dima >/dev/null 2>&1; then
  echo "未检测到 dima CLI，请先安装：" >&2
  echo "curl -o- https://antgys-gpk-oss.oss-cn-shanghai-alipay-office.oss-alipay.aliyuncs.com/script/dima-install.sh | bash" >&2
  exit 127
fi

# 单个缺陷详情查询
if [[ -n "$GET_ID" ]]; then
  exec dima bug get "$GET_ID" --with-custom-fields -o "$OUTPUT"
fi

# 如果未指定 processor，自动获取当前登录用户
if [[ -z "$PROCESSOR" ]]; then
  CURRENT_USER=$(get_current_user)
  if [[ -n "$CURRENT_USER" ]]; then
    PROCESSOR="$CURRENT_USER"
    echo "[info] 未指定 --processor，将查询当前用户 ($CURRENT_USER) 名下的 bug" >&2
  fi
fi

# 如果未指定项目/空间，自动获取用户参与的所有空间并遍历查询
AUTO_SPACES=""
if [[ -z "$PROJECT_ID" && -z "$SPACE_ID" ]]; then
  echo "[info] 未指定 -p/-s，将查询您参与的所有空间" >&2
  AUTO_SPACES=$(get_user_spaces)
  if [[ -z "$AUTO_SPACES" ]]; then
    echo "未找到您参与的空间，请先确认 dima 登录状态或手动指定 -p/-s 参数" >&2
    exit 2
  fi
  echo "[info] 发现您参与的空间数量: $(echo "$AUTO_SPACES" | wc -l | tr -d ' ')" >&2
fi

# 构建基础命令参数（不含空间/项目）
BASE_CMD=(dima bug list)
[[ -n "$PROCESSOR" ]]    && BASE_CMD+=(--processor "$PROCESSOR")
[[ -n "$STATUS_LIST" ]]  && BASE_CMD+=(--status-list "$STATUS_LIST")
$STATUS_ALL              && BASE_CMD+=(--status-all)
[[ -n "$SPRINT_ID" ]]    && BASE_CMD+=(--sprint-id "$SPRINT_ID")
[[ -n "$TAG"        ]]    && BASE_CMD+=(--tag "$TAG")
[[ -n "$SCOPE"      ]]    && BASE_CMD+=(--scope "$SCOPE")

# priority 通过 --filter 透传
COMBINED_FILTER="$FILTER"
if [[ -n "$PRIORITY" ]]; then
  if [[ -n "$COMBINED_FILTER" ]]; then
    COMBINED_FILTER="$COMBINED_FILTER priority=$PRIORITY"
  else
    COMBINED_FILTER="priority=$PRIORITY"
  fi
fi
[[ -n "$COMBINED_FILTER" ]] && BASE_CMD+=(--filter "$COMBINED_FILTER")

[[ -n "$PAGE"      ]]    && BASE_CMD+=(--page "$PAGE")
[[ -n "$PAGE_SIZE" ]]    && BASE_CMD+=(--page-size "$PAGE_SIZE")
$ALL                       && BASE_CMD+=(--all)

BASE_CMD+=(-o "$OUTPUT")

# 执行查询：指定了项目/空间则单次查询，否则遍历所有空间
if [[ -n "$PROJECT_ID" ]]; then
  CMD=("${BASE_CMD[@]}")
  CMD+=(-p "$PROJECT_ID")
  echo "[exec] ${CMD[*]}" >&2
  exec "${CMD[@]}"
elif [[ -n "$SPACE_ID" ]]; then
  CMD=("${BASE_CMD[@]}")
  CMD+=(-s "$SPACE_ID")
  echo "[exec] ${CMD[*]}" >&2
  exec "${CMD[@]}"
else
  # 遍历所有空间查询并汇总结果
  FIRST=true
  TOTAL_COUNT=0
  while IFS= read -r SPACE; do
    [[ -z "$SPACE" ]] && continue
    CMD=("${BASE_CMD[@]}")
    CMD+=(-s "$SPACE")
    echo "[exec] ${CMD[*]}" >&2
    RESULT=$("${CMD[@]}" 2>&1) || true
    # 检查是否有结果（非 "No work items found"）
    if [[ -n "$RESULT" && "$RESULT" != *"No work items found"* ]]; then
      if $FIRST; then
        echo "$RESULT"
        FIRST=false
      else
        # 跳过表头，只输出数据行（从第4行开始）
        echo "$RESULT" | tail -n +4
      fi
      # 统计数量（减去表头行）
      COUNT=$(echo "$RESULT" | grep -c "^|" || true)
      if [[ "$COUNT" -gt 2 ]]; then
        TOTAL_COUNT=$((TOTAL_COUNT + COUNT - 2))
      fi
    fi
  done <<< "$AUTO_SPACES"

  if $FIRST; then
    echo "No work items found."
  else
    echo "[info] 总计发现 $TOTAL_COUNT 个 bug" >&2
  fi
fi
