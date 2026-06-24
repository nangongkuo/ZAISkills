#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: discover-ios-project.sh [--project PATH] [--schemes]

Recursively discover iOS Xcode containers under PATH:
  - *.xcworkspace
  - *.xcodeproj

The project name is the file name before the extension:
  Foo.xcworkspace -> Foo
  Bar.xcodeproj   -> Bar

Options:
  --project, -p PATH    Root directory to search. Default: current directory.
  --schemes             Run xcodebuild -list for each discovered container.
  --help, -h            Show help.
USAGE
}

root="$(pwd)"
show_schemes=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project|-p)
      root="${2:-}"
      shift 2
      ;;
    --schemes)
      show_schemes=1
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

if [[ -z "$root" || ! -d "$root" ]]; then
  echo "Project root does not exist: $root" >&2
  exit 2
fi

root="$(cd "$root" && pwd)"

discover() {
  find "$root" -type d \( -name '*.xcworkspace' -o -name '*.xcodeproj' \) \
    -not -path '*/.git/*' \
    -not -path '*.xcodeproj/project.xcworkspace' \
    -print \
  | awk '
    /\.xcworkspace$/ { print "0\tworkspace\t" $0; next }
    /\.xcodeproj$/ { print "1\tproject\t" $0; next }
  ' \
  | sort -k1,1n -k3,3
}

trim() {
  sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

containers="$(discover)"

echo "Root: $root"
if [[ -z "$containers" ]]; then
  echo "No .xcworkspace or .xcodeproj found."
  exit 1
fi

echo
echo "Discovered Xcode containers:"
index=0
while IFS=$'\t' read -r _ kind path; do
  [[ -z "${path:-}" ]] && continue
  index=$((index + 1))
  base="$(basename "$path")"
  name="${base%.*}"
  printf '  %d. [%s] %s\n' "$index" "$kind" "$path"
  printf '      project_name: %s\n' "$name"
done <<< "$containers"

workspace_count="$(printf '%s\n' "$containers" | awk -F '\t' '$2 == "workspace" { count++ } END { print count + 0 }')"
project_count="$(printf '%s\n' "$containers" | awk -F '\t' '$2 == "project" { count++ } END { print count + 0 }')"
total_count=$((workspace_count + project_count))

echo
if [[ "$workspace_count" -eq 1 ]]; then
  default_path="$(printf '%s\n' "$containers" | awk -F '\t' '$2 == "workspace" { print $3; exit }')"
  echo "Suggested default: $default_path"
elif [[ "$workspace_count" -eq 0 && "$project_count" -eq 1 ]]; then
  default_path="$(printf '%s\n' "$containers" | awk -F '\t' '$2 == "project" { print $3; exit }')"
  echo "Suggested default: $default_path"
elif [[ "$total_count" -gt 1 ]]; then
  echo "Multiple candidates found. Confirm the workspace/project before build or run."
fi

if [[ "$show_schemes" -eq 1 ]]; then
  echo
  echo "Schemes:"
  while IFS=$'\t' read -r _ kind path; do
    [[ -z "${path:-}" ]] && continue
    echo
    echo "== $path =="
    if [[ "$kind" == "workspace" ]]; then
      xcodebuild -list -workspace "$path" 2>/dev/null | awk '
        /^[[:space:]]*Schemes:/ { capture=1; next }
        capture && NF { print "  - " $0 }
      ' | trim || true
    else
      xcodebuild -list -project "$path" 2>/dev/null | awk '
        /^[[:space:]]*Schemes:/ { capture=1; next }
        capture && NF { print "  - " $0 }
      ' | trim || true
    fi
  done <<< "$containers"
fi

echo
echo "Devices:"
if command -v xcrun >/dev/null 2>&1; then
  xcrun devicectl list devices || true
else
  echo "xcrun not found in PATH"
fi
