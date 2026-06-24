#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  filter-runtime-log.sh --log PATH [options]

Options:
  --log PATH              Runtime console log to inspect.
  --process NAME          Process name to highlight.
  --bundle-id ID          Bundle identifier to highlight.
  --keyword VALUE         Extra keyword or regex to match. Can be repeated.
  --tail N                Number of tail lines to print. Default: 80.
  --output PATH           Save filtered matches to a file.
  -h, --help              Show help.

The default check looks for common iOS runtime failure signals such as crash,
exception, abort, dyld, watchdog, OOM, and failed/error lines.
USAGE
}

log_path=""
process_name=""
bundle_id=""
tail_lines=80
output_path=""
keywords=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log)
      log_path="${2:-}"
      shift 2
      ;;
    --process)
      process_name="${2:-}"
      shift 2
      ;;
    --bundle-id)
      bundle_id="${2:-}"
      shift 2
      ;;
    --keyword)
      keywords+=("${2:-}")
      shift 2
      ;;
    --tail)
      tail_lines="${2:-}"
      shift 2
      ;;
    --output)
      output_path="${2:-}"
      shift 2
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

if [[ -z "$log_path" ]]; then
  echo "Missing --log" >&2
  exit 2
fi

if [[ ! -f "$log_path" ]]; then
  echo "Log file not found: $log_path" >&2
  exit 2
fi

if ! [[ "$tail_lines" =~ ^[0-9]+$ ]]; then
  echo "Invalid --tail value: $tail_lines" >&2
  exit 2
fi

default_pattern='(fatal|crash|exception|terminating app|abort|assert|sigabrt|sigsegv|watchdog|jetsam|oom|dyld|library not loaded|could not|failed|error|NSInvalidArgumentException|NSInternalInconsistencyException)'
patterns=("$default_pattern")
if [[ -n "$process_name" ]]; then
  patterns+=("$process_name")
fi
if [[ -n "$bundle_id" ]]; then
  patterns+=("$bundle_id")
fi
for keyword in "${keywords[@]}"; do
  if [[ -n "$keyword" ]]; then
    patterns+=("$keyword")
  fi
done

line_count="$(wc -l < "$log_path" | tr -d ' ')"
match_output=""
if command -v rg >/dev/null 2>&1; then
  rg_args=(-n -i)
  for pattern in "${patterns[@]}"; do
    rg_args+=(-e "$pattern")
  done
  set +e
  match_output="$(rg "${rg_args[@]}" "$log_path")"
  rg_status=$?
  set -e
  if [[ "$rg_status" -gt 1 ]]; then
    exit "$rg_status"
  fi
else
  set +e
  match_output="$(grep -Ein "$default_pattern" "$log_path")"
  grep_status=$?
  set -e
  if [[ "$grep_status" -gt 1 ]]; then
    exit "$grep_status"
  fi
fi

match_count=0
if [[ -n "$match_output" ]]; then
  match_count="$(printf '%s\n' "$match_output" | wc -l | tr -d ' ')"
fi

printf 'Log: %s\n' "$log_path"
printf 'Lines: %s\n' "$line_count"
printf 'Matches: %s\n' "$match_count"

if [[ -n "$process_name" ]] && command -v rg >/dev/null 2>&1; then
  pid_hints="$(rg -o "$process_name\\[[0-9]+" "$log_path" 2>/dev/null | sed "s/${process_name}\\[//" | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [[ -n "$pid_hints" ]]; then
    printf 'PID hints: %s\n' "$pid_hints"
  fi
fi

if [[ -n "$output_path" ]]; then
  mkdir -p "$(dirname "$output_path")"
  printf '%s\n' "$match_output" > "$output_path"
  printf 'Filtered output: %s\n' "$output_path"
fi

printf '\n== First Matches ==\n'
if [[ -n "$match_output" ]]; then
  printf '%s\n' "$match_output" | sed -n '1,80p'
else
  printf 'No matched failure or keyword lines.\n'
fi

printf '\n== Tail ==\n'
tail -n "$tail_lines" "$log_path"
