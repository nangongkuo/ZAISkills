#!/bin/bash
set -euo pipefail

# Usage: prepare-repo.sh <repo_url_or_local_path> <base_ref> <head_ref> <workspace_dir>
#
# 职责:
# 1. 定位/克隆仓库到 workspace_dir/cr-repos/<repo-name>/
# 2. 校验 origin URL（远程地址时）
# 3. 检查 dirty working tree
# 4. 确保 base_ref 和 head_ref 可用（分支则切到最新，commit 则 fetch 验证）
# 5. 验证 diff 范围有效
# 6. 输出仓库根目录路径（stdout 最后一行）

REPO_INPUT="$1"
BASE_REF="$2"
HEAD_REF="$3"
WORKSPACE_DIR="$4"

CACHE_DIR="$WORKSPACE_DIR/cr-repos"

# ----------------------------------------------------------------------
# 1. 定位仓库
# ----------------------------------------------------------------------
if [[ -d "$REPO_INPUT" ]]; then
  # 本地路径
  REPO_ROOT="$REPO_INPUT"
  cd "$REPO_ROOT"

  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "[ERROR] 本地路径不是有效的 git 仓库: $REPO_INPUT" >&2
    exit 1
  fi
  echo "[INFO] 使用本地仓库: $REPO_ROOT" >&2
else
  # 远程地址: 提取 repo name
  REPO_NAME=$(basename "$REPO_INPUT" .git)
  REPO_ROOT="$CACHE_DIR/$REPO_NAME"

  if [[ -d "$REPO_ROOT" ]]; then
    cd "$REPO_ROOT"
    ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
    if [[ "${ORIGIN_URL:-}" != "$REPO_INPUT" ]]; then
      echo "[ERROR] 缓存目录 $REPO_ROOT 已存在，但 origin URL 不匹配" >&2
      echo "  期望: $REPO_INPUT" >&2
      echo "  实际: ${ORIGIN_URL:-(none)}" >&2
      echo "  请手动删除或重命名该目录后重试" >&2
      exit 1
    fi
    echo "[INFO] 更新已有仓库: $REPO_ROOT" >&2
    git fetch origin --prune
  else
    mkdir -p "$CACHE_DIR"
    echo "[INFO] 克隆仓库到: $REPO_ROOT" >&2
    git clone "$REPO_INPUT" "$REPO_ROOT"
    cd "$REPO_ROOT"
  fi
fi

# 确保在仓库根目录
cd "$REPO_ROOT"

# ----------------------------------------------------------------------
# 2. 检查 dirty working tree
# ----------------------------------------------------------------------
DIRTY_FILES=$(git status --short || true)
if [[ -n "${DIRTY_FILES:-}" ]]; then
  echo "[ERROR] 工作区存在未提交的更改:" >&2
  echo "$DIRTY_FILES" >&2
  echo "请先提交、暂存或清理后再重试" >&2
  exit 1
fi

# ----------------------------------------------------------------------
# 3. 确保 base_ref 和 head_ref 可用
# ----------------------------------------------------------------------
ensure_ref() {
  local ref="$1"

  # 本地已存在（分支、tag、commit）
  if git rev-parse --verify "$ref" >/dev/null 2>&1; then
    return 0
  fi

  # 远程分支: 创建本地跟踪分支
  if git rev-parse --verify "origin/$ref" >/dev/null 2>&1; then
    git checkout -B "$ref" "origin/$ref"
    return 0
  fi

  # 尝试 fetch（可能是 commit hash 或远程 tag）
  if git fetch origin "$ref" 2>/dev/null; then
    if git rev-parse --verify "FETCH_HEAD" >/dev/null 2>&1; then
      # 对于 commit hash, fetch 后 FETCH_HEAD 即指向它
      return 0
    fi
    if git rev-parse --verify "$ref" >/dev/null 2>&1; then
      return 0
    fi
  fi

  echo "[ERROR] 无法解析引用: $ref" >&2
  exit 1
}

ensure_ref "$BASE_REF"
ensure_ref "$HEAD_REF"

# ----------------------------------------------------------------------
# 4. 目标分支切到最新（仅当是分支时）
# ----------------------------------------------------------------------
# 如果 HEAD_REF 看起来像分支（本地或远程有对应分支引用），则 checkout 并 pull
if git show-ref --verify --quiet "refs/heads/$HEAD_REF" 2>/dev/null || \
   git show-ref --verify --quiet "refs/remotes/origin/$HEAD_REF" 2>/dev/null; then
  git checkout "$HEAD_REF"
  git pull origin "$HEAD_REF" 2>/dev/null || true
fi

# ----------------------------------------------------------------------
# 5. 验证 diff 范围
# ----------------------------------------------------------------------
if ! git log "${BASE_REF}..${HEAD_REF}" --oneline >/dev/null 2>&1; then
  echo "[ERROR] diff 范围无效: ${BASE_REF}..${HEAD_REF}" >&2
  exit 1
fi

echo "[INFO] 仓库准备完成: $REPO_ROOT" >&2
echo "$REPO_ROOT"
