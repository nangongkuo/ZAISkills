#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(pwd)"
ITERATION_ID=""
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: sync-baseline.sh [--project PATH] [--iteration CP_ID] [--dry-run]

Synchronize an iOS project's AntCLI baseline:
  1. anc clean -f
  2. anc sync <iteration>

When --iteration is omitted, the script extracts a Huoban iteration ID from
the current git branch. If the branch has no ID, it prompts for one.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project|-p)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --iteration|-i)
      ITERATION_ID="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PROJECT_DIR" || ! -d "$PROJECT_DIR" ]]; then
  echo "Project directory does not exist: $PROJECT_DIR" >&2
  exit 2
fi

extract_iteration() {
  local value="$1"
  echo "$value" | grep -Eo 'cp_[A-Za-z][A-Za-z0-9]*_[0-9]+' | head -n 1 || true
}

is_valid_iteration() {
  [[ "$1" =~ ^cp_[A-Za-z][A-Za-z0-9]*_[0-9]+$ ]]
}

if [[ -z "$ITERATION_ID" ]]; then
  BRANCH_NAME="$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || true)"
  if [[ -z "$BRANCH_NAME" ]]; then
    BRANCH_NAME="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  fi
  ITERATION_ID="$(extract_iteration "$BRANCH_NAME")"
fi

if [[ -z "$ITERATION_ID" ]]; then
  echo "Unable to detect Huoban iteration ID from git branch."
  read -r -p "Please input Huoban iteration ID (for example cp_masterChange_115600880): " ITERATION_ID
fi

if ! is_valid_iteration "$ITERATION_ID"; then
  echo "Invalid Huoban iteration ID: $ITERATION_ID" >&2
  echo "Expected format: cp_masterChange_115600880" >&2
  exit 2
fi

if ! command -v anc >/dev/null 2>&1; then
  echo "AntCLI command 'anc' was not found in PATH." >&2
  echo "Install AntCLI or fix PATH, then retry." >&2
  exit 127
fi

run_cmd() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    "$@"
  fi
}

echo "Project: $PROJECT_DIR"
echo "Iteration: $ITERATION_ID"

cd "$PROJECT_DIR"
run_cmd anc clean -f
run_cmd anc sync "$ITERATION_ID"

echo "Baseline sync finished for $ITERATION_ID."
