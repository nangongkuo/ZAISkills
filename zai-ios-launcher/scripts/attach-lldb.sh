#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  attach-lldb.sh --device <device-name-or-id> (--process <name> | --pid <pid>) [options]

Options:
  --project <path>        Project root used to find the default Xcode DerivedData log folder.
  --device <value>        Device name or CoreDevice identifier, e.g. "My iPhone".
  --process <name>        Process name to attach, e.g. MyApp.
  --pid <pid>             Process id to attach.
  --bundle-id <id>        Bundle id, recorded in the generated command filename only.
  --commands <path>       Extra LLDB commands to append after attach.
  --wait                  Wait for the process name to launch before attaching.
  --include-existing      Include existing processes when using --wait.
  --continue              Continue the process immediately after attach.
  --batch                 Run LLDB in batch mode. Useful for one-shot commands such as backtrace.
  --dry-run               Print the generated LLDB command file and exit.
  -h, --help              Show this help.

Examples:
  attach-lldb.sh --device "My iPhone" --process MyApp
  attach-lldb.sh --device 5F887FC3-BFC0-5336-8236-4380CA17D8BF --pid 1092 --batch --commands /tmp/lldb.bt
EOF
}

project=""
device=""
process_name=""
pid=""
bundle_id=""
extra_commands=""
wait_for_process=0
include_existing=0
continue_after_attach=0
batch=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      project="${2:-}"
      shift 2
      ;;
    --device)
      device="${2:-}"
      shift 2
      ;;
    --process)
      process_name="${2:-}"
      shift 2
      ;;
    --pid)
      pid="${2:-}"
      shift 2
      ;;
    --bundle-id)
      bundle_id="${2:-}"
      shift 2
      ;;
    --commands)
      extra_commands="${2:-}"
      shift 2
      ;;
    --wait)
      wait_for_process=1
      shift
      ;;
    --include-existing)
      include_existing=1
      shift
      ;;
    --continue)
      continue_after_attach=1
      shift
      ;;
    --batch)
      batch=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
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

if [[ -z "$device" ]]; then
  echo "Missing --device" >&2
  exit 2
fi

if [[ -z "$process_name" && -z "$pid" ]]; then
  echo "Missing --process or --pid" >&2
  exit 2
fi

if [[ -n "$process_name" && -n "$pid" ]]; then
  echo "Use only one of --process or --pid" >&2
  exit 2
fi

if [[ -n "$pid" && "$wait_for_process" -eq 1 ]]; then
  echo "--wait can only be used with --process" >&2
  exit 2
fi

if [[ -n "$extra_commands" && ! -f "$extra_commands" ]]; then
  echo "Extra command file not found: $extra_commands" >&2
  exit 2
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required but was not found" >&2
  exit 1
fi

derived_root="${HOME}/Library/Developer/Xcode/DerivedData"
project_name=""
if [[ -n "$project" ]]; then
  if [[ "$project" == *.xcworkspace || "$project" == *.xcodeproj ]]; then
    project_name="$(basename "$project")"
    project_name="${project_name%.*}"
  elif [[ -d "$project" ]]; then
    candidate="$(find "$project" -type d \( -name '*.xcworkspace' -o -name '*.xcodeproj' \) -not -path '*/.git/*' -not -path '*.xcodeproj/project.xcworkspace' -print 2>/dev/null | sort | awk '/\.xcworkspace$/ { print; exit } END { }')"
    if [[ -z "${candidate:-}" ]]; then
      candidate="$(find "$project" -type d -name '*.xcodeproj' -not -path '*/.git/*' -print 2>/dev/null | sort | head -n 1)"
    fi
    if [[ -n "${candidate:-}" ]]; then
      project_name="$(basename "$candidate")"
      project_name="${project_name%.*}"
    else
      project_name="$(basename "$project")"
    fi
  fi
fi

if [[ -n "$project_name" ]]; then
  log_root="$(find "$derived_root" -maxdepth 1 -type d -name "$project_name-*" -print0 2>/dev/null | xargs -0 stat -f '%m %N' 2>/dev/null | sort -nr | awk 'NR==1 {print substr($0, index($0,$2))}')"
else
  log_root=""
fi

if [[ -z "${log_root:-}" ]]; then
  log_root="${derived_root}/AgentLogs"
fi

lldb_dir="${log_root}/Logs/Debug"
mkdir -p "$lldb_dir"

lldb_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

timestamp="$(date +%Y%m%d-%H%M%S)"
target_name="${process_name:-pid-${pid}}"
safe_target="$(printf '%s' "$target_name" | tr -c '[:alnum:]._-+' '_')"
safe_bundle=""
if [[ -n "$bundle_id" ]]; then
  safe_bundle="-$(printf '%s' "$bundle_id" | tr -c '[:alnum:]._-+' '_')"
fi

command_file="${lldb_dir}/agent-${timestamp}-lldb-${safe_target}${safe_bundle}.lldb"

{
  printf 'device select %s\n' "$(lldb_quote "$device")"
  attach_cmd="device process attach"
  if [[ "$continue_after_attach" -eq 1 ]]; then
    attach_cmd+=" --continue"
  fi
  if [[ -n "$pid" ]]; then
    attach_cmd+=" --pid ${pid}"
  else
    if [[ "$wait_for_process" -eq 1 ]]; then
      attach_cmd+=" --waitfor"
      if [[ "$include_existing" -eq 1 ]]; then
        attach_cmd+=" --include-existing"
      fi
    fi
    attach_cmd+=" --name $(lldb_quote "$process_name")"
  fi
  printf '%s\n' "$attach_cmd"
  if [[ -n "$extra_commands" ]]; then
    cat "$extra_commands"
  fi
} > "$command_file"

echo "LLDB command file: $command_file"
echo "Device: $device"
if [[ -n "$pid" ]]; then
  echo "Attach target: pid $pid"
else
  echo "Attach target: process $process_name"
fi

if [[ "$dry_run" -eq 1 ]]; then
  echo "---"
  cat "$command_file"
  exit 0
fi

if [[ "$batch" -eq 1 ]]; then
  exec xcrun lldb --batch -s "$command_file"
else
  exec xcrun lldb -s "$command_file"
fi
