#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  run-ios-device.sh --device DEVICE [options]

Generic real-device flow:
  1. Select an .xcworkspace or .xcodeproj.
  2. Build the selected scheme for the confirmed physical device.
  3. Locate the built .app in Xcode default DerivedData.
  4. Verify the .app signature and embedded provisioning profile before install.
  5. Install the app with devicectl.
  6. Launch the bundle with --console and save runtime output under DerivedData Logs/Console.
  7. Record the launched app PID from devicectl JSON for later terminate commands.
  8. Filter the saved console log when the launch command exits.

Options:
  --project PATH                 Root directory to search. Default: current directory.
  --workspace PATH               Selected .xcworkspace.
  --xcodeproj PATH               Selected .xcodeproj.
  --pbxproj PATH                 project.pbxproj used for signing preparation.
  --signing-xcodeproj PATH       .xcodeproj used for signing preparation.
  --scheme NAME                  Xcode scheme. Required when multiple schemes exist.
  --device VALUE                 Confirmed CoreDevice id/name. Required.
  --bundle-id ID                 Bundle Identifier to launch. Required unless --build-only.
  --dev-team ID                  Confirmed Apple Development Team ID.
  --code-sign-identity NAME      App-target CODE_SIGN_IDENTITY for prepare. Default: Apple Development.
  --skip-code-sign-identity      Do not update app-target CODE_SIGN_IDENTITY during prepare.
  --configuration NAME           Build configuration. Default: Debug.
  --app-path PATH                Existing .app to install instead of discovering from DerivedData.
  --app-name NAME                Preferred app bundle name, e.g. MyApp.app or MyApp.
  --process-name NAME            Runtime process name for log filtering. Default: app name or scheme.
  --build-only                   Stop after build.
  --install-only                 Skip build and launch; install --app-path or discovered app.
  --launch-only                  Skip build and install; only launch and collect console.
  --no-build                     Skip build.
  --no-install                   Skip install.
  --no-launch                    Skip launch.
  --skip-prepare                 Skip Bundle Identifier/Development Team/Code Sign Identity preparation.
  --no-auto-dev-team             Do not auto-discover a Development Team when none is set.
  --update-all-bundle-ids        Allow prepare step to replace multiple Bundle Identifiers.
  --update-all-dev-teams         Allow prepare step to replace non-empty Development Teams.
  --update-all-code-sign-identities Allow replacing non-empty app-target CODE_SIGN_IDENTITY values.
  --remove-iap                   Remove com.apple.InAppPurchase capability during prepare.
  --allow-provisioning-updates   Pass -allowProvisioningUpdates to xcodebuild.
  --terminate-existing           Terminate an existing app instance before launch.
  --sample-seconds N             Explicit bounded console window; passed to devicectl --timeout.
  --yes                          Skip interactive run confirmation after parameters are printed.
  --dry-run                      Print commands without executing them.
  -h, --help                     Show help.

Do not use --sample-seconds for a normal run. A normal launch keeps console
collection active until the user exits the app or stops the command.
USAGE
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="$(pwd)"
workspace=""
xcodeproj=""
pbxproj=""
signing_xcodeproj=""
scheme=""
device=""
bundle_id=""
dev_team=""
code_sign_identity="Apple Development"
configuration="Debug"
app_path=""
app_name=""
process_name=""
do_build=1
do_install=1
do_launch=1
skip_prepare=0
auto_dev_team=1
update_all_bundle_ids=0
update_all_dev_teams=0
skip_code_sign_identity=0
update_all_code_sign_identities=0
remove_iap=0
allow_provisioning_updates=0
terminate_existing=0
sample_seconds=""
yes=0
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project|-p)
      project="${2:-}"
      shift 2
      ;;
    --workspace)
      workspace="${2:-}"
      shift 2
      ;;
    --xcodeproj)
      xcodeproj="${2:-}"
      shift 2
      ;;
    --pbxproj)
      pbxproj="${2:-}"
      shift 2
      ;;
    --signing-xcodeproj)
      signing_xcodeproj="${2:-}"
      shift 2
      ;;
    --scheme)
      scheme="${2:-}"
      shift 2
      ;;
    --device|-d)
      device="${2:-}"
      shift 2
      ;;
    --bundle-id)
      bundle_id="${2:-}"
      shift 2
      ;;
    --dev-team)
      dev_team="${2:-}"
      shift 2
      ;;
    --code-sign-identity)
      code_sign_identity="${2:-}"
      shift 2
      ;;
    --skip-code-sign-identity)
      skip_code_sign_identity=1
      shift
      ;;
    --configuration)
      configuration="${2:-}"
      shift 2
      ;;
    --app-path)
      app_path="${2:-}"
      shift 2
      ;;
    --app-name)
      app_name="${2:-}"
      shift 2
      ;;
    --process-name)
      process_name="${2:-}"
      shift 2
      ;;
    --build-only)
      do_build=1
      do_install=0
      do_launch=0
      shift
      ;;
    --install-only)
      do_build=0
      do_install=1
      do_launch=0
      shift
      ;;
    --launch-only)
      do_build=0
      do_install=0
      do_launch=1
      shift
      ;;
    --no-build)
      do_build=0
      shift
      ;;
    --no-install)
      do_install=0
      shift
      ;;
    --no-launch)
      do_launch=0
      shift
      ;;
    --skip-prepare)
      skip_prepare=1
      shift
      ;;
    --no-auto-dev-team)
      auto_dev_team=0
      shift
      ;;
    --update-all-bundle-ids)
      update_all_bundle_ids=1
      shift
      ;;
    --update-all-dev-teams)
      update_all_dev_teams=1
      shift
      ;;
    --update-all-code-sign-identities)
      update_all_code_sign_identities=1
      shift
      ;;
    --remove-iap)
      remove_iap=1
      shift
      ;;
    --allow-provisioning-updates)
      allow_provisioning_updates=1
      shift
      ;;
    --terminate-existing)
      terminate_existing=1
      shift
      ;;
    --sample-seconds)
      sample_seconds="${2:-}"
      shift 2
      ;;
    --yes)
      yes=1
      shift
      ;;
    --dry-run)
      dry_run=1
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

if [[ -z "$device" ]]; then
  echo "Missing --device" >&2
  exit 2
fi

if [[ "$do_launch" -eq 1 && -z "$bundle_id" ]]; then
  echo "Missing --bundle-id for launch" >&2
  exit 2
fi

if [[ -n "$workspace" && -n "$xcodeproj" ]]; then
  echo "Pass either --workspace or --xcodeproj, not both." >&2
  exit 2
fi

if [[ -n "$sample_seconds" && ! "$sample_seconds" =~ ^[0-9]+$ ]]; then
  echo "Invalid --sample-seconds value: $sample_seconds" >&2
  exit 2
fi

project="$(cd "$project" && pwd)"

discover_one() {
  local pattern="$1"
  find "$project" -type d -name "$pattern" \
    -not -path '*/.git/*' \
    -not -path '*.xcodeproj/project.xcworkspace' \
    -print | sort
}

if [[ -z "$workspace" && -z "$xcodeproj" ]]; then
  workspaces="$(discover_one "*.xcworkspace")"
  projects="$(discover_one "*.xcodeproj")"
  workspace_count="$(printf '%s\n' "$workspaces" | sed '/^$/d' | wc -l | tr -d ' ')"
  project_count="$(printf '%s\n' "$projects" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$workspace_count" -eq 1 ]]; then
    workspace="$workspaces"
  elif [[ "$workspace_count" -eq 0 && "$project_count" -eq 1 ]]; then
    xcodeproj="$projects"
  else
    echo "Could not select a unique Xcode container." >&2
    "$script_dir/discover-ios-project.sh" --project "$project" >&2 || true
    exit 2
  fi
fi

if [[ -n "$workspace" ]]; then
  [[ -d "$workspace" ]] || { echo "Workspace not found: $workspace" >&2; exit 2; }
  container_args=(-workspace "$workspace")
  container_path="$workspace"
else
  [[ -d "$xcodeproj" ]] || { echo "Xcode project not found: $xcodeproj" >&2; exit 2; }
  container_args=(-project "$xcodeproj")
  container_path="$xcodeproj"
fi

project_name="$(basename "$container_path")"
project_name="${project_name%.*}"

list_schemes() {
  xcodebuild -list "${container_args[@]}" 2>/dev/null | awk '
    /^[[:space:]]*Schemes:/ { capture=1; next }
    capture && NF { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print }
  '
}

if [[ -z "$scheme" ]]; then
  schemes="$(list_schemes)"
  scheme_count="$(printf '%s\n' "$schemes" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$scheme_count" -eq 1 ]]; then
    scheme="$schemes"
  else
    echo "Could not select a unique scheme." >&2
    printf '%s\n' "$schemes" | sed 's/^/  - /' >&2
    exit 2
  fi
fi

resolve_signing_pbxproj() {
  if [[ -n "$pbxproj" ]]; then
    printf '%s\n' "$pbxproj"
    return
  fi
  if [[ -n "$signing_xcodeproj" ]]; then
    printf '%s\n' "$signing_xcodeproj/project.pbxproj"
    return
  fi
  if [[ -n "$xcodeproj" ]]; then
    printf '%s\n' "$xcodeproj/project.pbxproj"
    return
  fi
  if [[ -n "$workspace" ]]; then
    local scheme_project
    scheme_project="$(find "$project" -type d -name "${scheme}.xcodeproj" -not -path '*/.git/*' -print | sort)"
    if [[ "$(printf '%s\n' "$scheme_project" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1 ]]; then
      printf '%s\n' "$scheme_project/project.pbxproj"
      return
    fi
    local sibling
    sibling="$(dirname "$workspace")/${project_name}.xcodeproj/project.pbxproj"
    if [[ -f "$sibling" ]]; then
      printf '%s\n' "$sibling"
      return
    fi
  fi
}

read_dev_team_from_pbxproj() {
  local path="$1"
  if [[ -z "$path" || ! -f "$path" ]]; then
    return
  fi
  awk -F '= ' '
    /DEVELOPMENT_TEAM = / || /DevelopmentTeam = / {
      value=$2
      gsub(/;$/, "", value)
      gsub(/"/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (value != "") seen[value]=1
    }
    END {
      first=1
      for (value in seen) {
        if (!first) printf ","
        printf "%s", value
        first=0
      }
    }
  ' "$path"
}

discover_single_local_dev_team() {
  local teams
  teams="$("$script_dir/prepare-device-run.py" --print-local-dev-teams 2>/dev/null | awk '/^  - [A-Z0-9]{10}$/ { print $2 }')"
  if [[ "$(printf '%s\n' "$teams" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1 ]]; then
    printf '%s\n' "$teams"
  fi
}

latest_derived_data() {
  find "${HOME}/Library/Developer/Xcode/DerivedData" -maxdepth 1 -type d -name "${project_name}-*" -print0 2>/dev/null \
    | xargs -0 stat -f '%m %N' 2>/dev/null \
    | sort -nr \
    | awk 'NR==1 { $1=""; sub(/^ /, ""); print }'
}

safe_name() {
  printf '%s' "$1" | tr -c '[:alnum:]._-+' '_'
}

print_cmd() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
}

run_cmd() {
  print_cmd "$@"
  if [[ "$dry_run" -eq 0 ]]; then
    "$@"
  fi
}

app_bundle_identifier() {
  local app="$1"
  plutil -extract CFBundleIdentifier raw -o - "$app/Info.plist" 2>/dev/null || true
}

verify_app_signature() {
  local app="$1"
  local expected_bundle="${2:-}"
  local expected_team="${3:-}"
  local actual_bundle
  local profile
  local decoded_profile
  local profile_app_id
  local profile_team
  local bundle_pattern

  echo
  echo "== App Signature Preflight =="
  echo "App path: $app"
  if [[ ! -d "$app" ]]; then
    echo "Signature preflight failed: app bundle not found: $app" >&2
    return 1
  fi
  if [[ ! -f "$app/Info.plist" ]]; then
    echo "Signature preflight failed: Info.plist not found in app bundle." >&2
    return 1
  fi
  actual_bundle="$(app_bundle_identifier "$app")"
  if [[ -z "$actual_bundle" ]]; then
    echo "Signature preflight failed: could not read CFBundleIdentifier." >&2
    return 1
  fi
  echo "Bundle Identifier: $actual_bundle"
  if [[ -n "$expected_bundle" && "$actual_bundle" != "$expected_bundle" ]]; then
    echo "Signature preflight failed: app Bundle Identifier '$actual_bundle' does not match expected '$expected_bundle'." >&2
    return 1
  fi
  if [[ ! -d "$app/_CodeSignature" ]]; then
    echo "Signature preflight failed: _CodeSignature missing." >&2
    return 1
  fi
  if ! codesign --verify --deep --strict --verbose=2 "$app"; then
    echo "Signature preflight failed: codesign verification failed." >&2
    return 1
  fi
  profile="$app/embedded.mobileprovision"
  if [[ ! -f "$profile" ]]; then
    echo "Signature preflight failed: embedded.mobileprovision missing." >&2
    return 1
  fi
  decoded_profile="$(mktemp)"
  if ! security cms -D -i "$profile" > "$decoded_profile"; then
    rm -f "$decoded_profile"
    echo "Signature preflight failed: cannot decode embedded.mobileprovision." >&2
    return 1
  fi
  profile_app_id="$(plutil -extract Entitlements.application-identifier raw -o - "$decoded_profile" 2>/dev/null || true)"
  profile_team="$(plutil -extract TeamIdentifier.0 raw -o - "$decoded_profile" 2>/dev/null || true)"
  rm -f "$decoded_profile"
  if [[ -z "$profile_app_id" ]]; then
    echo "Signature preflight failed: provisioning profile missing application-identifier." >&2
    return 1
  fi
  echo "Provisioning application-identifier: $profile_app_id"
  if [[ -n "$profile_team" ]]; then
    echo "Provisioning Team: $profile_team"
  fi
  if [[ -n "$expected_team" && "$expected_team" != "(not set)" && -n "$profile_team" && "$profile_team" != "$expected_team" ]]; then
    echo "Signature preflight failed: provisioning TeamIdentifier '$profile_team' does not match expected '$expected_team'." >&2
    return 1
  fi
  if [[ -n "$expected_bundle" ]]; then
    bundle_pattern="$profile_app_id"
    if [[ -n "$profile_team" && "$bundle_pattern" == "$profile_team."* ]]; then
      bundle_pattern="${bundle_pattern#"$profile_team."}"
    fi
    case "$expected_bundle" in
      $bundle_pattern)
        ;;
      *)
        echo "Signature preflight failed: provisioning application identifier '$profile_app_id' does not allow Bundle Identifier '$expected_bundle'." >&2
        return 1
        ;;
    esac
  fi
  codesign -dv --verbose=2 "$app" 2>&1 | awk -F= '
    /^Authority=/ { print "Signer: " $2 }
    /^TeamIdentifier=/ { print "Signed Team: " $2 }
  '
  echo "Signature preflight passed."
}

read_launch_pid() {
  local json_path="$1"
  if [[ -f "$json_path" ]]; then
    plutil -extract result.process.processIdentifier raw -o - "$json_path" 2>/dev/null || true
  fi
}













write_launch_context() {
  local state="$1"
  local exit_code_value="${2:-}"
  {
    echo "state=$state"
    echo "updated_at=$(date '+%Y-%m-%d %H:%M:%S')"
    echo "project=$project"
    echo "xcode_container=$container_path"
    echo "scheme=$scheme"
    echo "device=$device"
    echo "bundle_id=$bundle_id"
    echo "process_name=$process_name"
    echo "app_pid=${app_pid:-}"
    echo "collector_pid=${launch_host_pid:-}"
    echo "exit_code=$exit_code_value"
    echo "console_log=${console_log:-}"
    echo "launch_json=${launch_json:-}"
    echo "devicectl_log=${devicectl_log:-}"
    if [[ -n "${app_pid:-}" ]]; then
      echo "terminate_command=xcrun devicectl device process terminate --device $device --pid $app_pid --kill"
    fi
  } > "$status_file"
  cp "$status_file" "$current_context_file"
}

signing_pbxproj="$(resolve_signing_pbxproj || true)"
if [[ -n "$signing_pbxproj" && ! -f "$signing_pbxproj" ]]; then
  echo "Signing project file not found: $signing_pbxproj" >&2
  exit 2
fi

if [[ "$skip_prepare" -eq 0 && -n "$signing_pbxproj" ]]; then
  prepare_cmd=("$script_dir/prepare-device-run.py" --project "$project" --pbxproj "$signing_pbxproj" --device "$device")
  if [[ -n "$bundle_id" ]]; then
    prepare_cmd+=(--bundle-id "$bundle_id")
  fi
  if [[ -n "$dev_team" ]]; then
    prepare_cmd+=(--dev-team "$dev_team")
  elif [[ "$auto_dev_team" -eq 1 ]]; then
    prepare_cmd+=(--auto-dev-team)
  fi
  if [[ "$update_all_bundle_ids" -eq 1 ]]; then
    prepare_cmd+=(--update-all-bundle-ids)
  fi
  if [[ "$update_all_dev_teams" -eq 1 ]]; then
    prepare_cmd+=(--update-all-dev-teams)
  fi
  if [[ "$skip_code_sign_identity" -eq 1 ]]; then
    prepare_cmd+=(--skip-code-sign-identity)
  elif [[ -n "$code_sign_identity" ]]; then
    prepare_cmd+=(--code-sign-identity "$code_sign_identity")
  fi
  if [[ "$update_all_code_sign_identities" -eq 1 ]]; then
    prepare_cmd+=(--update-all-code-sign-identities)
  fi
  if [[ "$remove_iap" -eq 1 ]]; then
    prepare_cmd+=(--remove-iap)
  fi
  if [[ "$yes" -eq 1 ]]; then
    prepare_cmd+=(--yes)
  fi
  if [[ "$dry_run" -eq 1 ]]; then
    prepare_cmd+=(--dry-run)
  fi
  print_cmd "${prepare_cmd[@]}"
  "${prepare_cmd[@]}"
fi

if [[ -z "$dev_team" && -n "$signing_pbxproj" ]]; then
  dev_team="$(read_dev_team_from_pbxproj "$signing_pbxproj" || true)"
fi
if [[ -z "$dev_team" && "$auto_dev_team" -eq 1 ]]; then
  dev_team="$(discover_single_local_dev_team || true)"
fi
if [[ -z "$dev_team" ]]; then
  dev_team="(not set)"
fi

echo
echo "== Run Parameters =="
echo "Project root: $project"
echo "Xcode container: $container_path"
echo "Project name: $project_name"
echo "Scheme: $scheme"
echo "Device: $device"
echo "Bundle Identifier: ${bundle_id:-"(not set)"}"
echo "Development Team: $dev_team"
if [[ "$skip_code_sign_identity" -eq 1 ]]; then
  echo "Code Sign Identity prepare: skipped"
else
  echo "Code Sign Identity prepare: ${code_sign_identity:-"(not set)"}"
fi
if [[ -n "$signing_pbxproj" ]]; then
  echo "Signing project file: $signing_pbxproj"
else
  echo "Signing project file: (not resolved)"
fi

if [[ "$dry_run" -eq 0 && "$yes" -eq 0 ]]; then
  if ! [[ -t 0 ]]; then
    echo "Pass --yes after confirming the run parameters." >&2
    exit 2
  fi
  read -r -p "Confirm device, scheme, Bundle Identifier, and Development Team are correct? [y/N] " confirmation
  case "$confirmation" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Run cancelled."
      exit 1
      ;;
  esac
fi

if [[ "$do_build" -eq 1 ]]; then
  build_cmd=(xcodebuild "${container_args[@]}" -scheme "$scheme" -configuration "$configuration" -destination "id=$device")
  if [[ "$allow_provisioning_updates" -eq 1 ]]; then
    build_cmd+=(-allowProvisioningUpdates)
  fi
  build_cmd+=(build)
  run_cmd "${build_cmd[@]}"
fi

if [[ "$do_install" -eq 1 ]]; then
  if [[ -z "$app_path" ]]; then
    derived_data="$(latest_derived_data || true)"
    if [[ -z "${derived_data:-}" ]]; then
      echo "No DerivedData folder found for project prefix: $project_name" >&2
      exit 1
    fi
    products_dir="$derived_data/Build/Products/${configuration}-iphoneos"
    if [[ ! -d "$products_dir" ]]; then
      echo "Build products folder not found: $products_dir" >&2
      exit 1
    fi
    if [[ -n "$app_name" ]]; then
      app_name="${app_name%.app}.app"
      app_path="$(find "$products_dir" -maxdepth 2 -type d -name "$app_name" -print0 \
        | xargs -0 stat -f '%m %N' 2>/dev/null \
        | sort -nr \
        | awk 'NR==1 { $1=""; sub(/^ /, ""); print }')"
    else
      app_path="$(find "$products_dir" -maxdepth 2 -type d -name "*.app" -print0 \
        | xargs -0 stat -f '%m %N' 2>/dev/null \
        | sort -nr \
        | awk 'NR==1 { $1=""; sub(/^ /, ""); print }')"
    fi
    if [[ -z "${app_path:-}" ]]; then
      echo "No .app found under $products_dir" >&2
      exit 1
    fi
  fi
fi

if [[ -z "$process_name" ]]; then
  if [[ -n "$app_path" ]]; then
    process_name="$(basename "$app_path")"
    process_name="${process_name%.app}"
  else
    process_name="$scheme"
  fi
fi

log_root="$(latest_derived_data || true)"
if [[ -z "${log_root:-}" ]]; then
  log_root="${HOME}/Library/Developer/Xcode/DerivedData/AgentLogs/${project_name}"
fi
console_dir="$log_root/Logs/Console"
mkdir -p "$console_dir"

timestamp="$(date +%Y%m%d-%H%M%S)"
safe_bundle="$(safe_name "${bundle_id:-no-bundle}")"
safe_process="$(safe_name "$process_name")"

if [[ "$do_install" -eq 1 ]]; then
  if [[ -z "$app_path" || ! -d "$app_path" ]]; then
    echo "App path not found: $app_path" >&2
    exit 1
  fi
  if [[ "$dry_run" -eq 0 ]]; then
    verify_app_signature "$app_path" "${bundle_id:-}" "$dev_team"
  else
    echo
    echo "== App Signature Preflight =="
    echo "Skipped in dry-run mode."
  fi
  install_json="$console_dir/agent-${timestamp}-install-${safe_bundle}.json"
  install_log="$console_dir/agent-${timestamp}-install-${safe_bundle}.log"
  run_cmd xcrun devicectl device install app --device "$device" "$app_path" --json-output "$install_json" --log-output "$install_log"
  echo "Install JSON: $install_json"
  echo "Install log: $install_log"
fi

if [[ "$do_launch" -eq 1 ]]; then
  launch_json="$console_dir/agent-${timestamp}-launch-${safe_bundle}.json"
  devicectl_log="$console_dir/agent-${timestamp}-launch-${safe_bundle}.devicectl.log"
  console_log="$console_dir/agent-${timestamp}-${safe_process}-${safe_bundle}.log"
  status_file="$console_dir/agent-${timestamp}-${safe_process}-${safe_bundle}.status"
  current_context_file="$console_dir/agent-current-run.status"
  launch_cmd=(xcrun devicectl device process launch --device "$device" --console --json-output "$launch_json" --log-output "$devicectl_log")
  if [[ "$terminate_existing" -eq 1 ]]; then
    launch_cmd+=(--terminate-existing)
  fi
  if [[ -n "$sample_seconds" ]]; then
    launch_cmd+=(--timeout "$sample_seconds")
  fi
  launch_cmd+=("$bundle_id")

  print_cmd "${launch_cmd[@]}"
  echo "Console log: $console_log"
  echo "Launch JSON: $launch_json"
  echo "devicectl log: $devicectl_log"

  if [[ "$dry_run" -eq 0 ]]; then
    set +e
    "${launch_cmd[@]}" > "$console_log" 2>&1 &
    launch_host_pid=$!
    app_pid=""
    for _ in {1..100}; do
      app_pid="$(read_launch_pid "$launch_json")"
      if [[ -n "$app_pid" ]]; then
        break
      fi
      if ! kill -0 "$launch_host_pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if [[ -n "$app_pid" ]]; then
      write_launch_context "running" ""
      echo "Launched app PID: $app_pid"
      echo "Current run context: $current_context_file"
    fi
    wait "$launch_host_pid"
    exit_code=$?
    if [[ -z "$app_pid" ]]; then
      app_pid="$(read_launch_pid "$launch_json")"
    fi
    set -e
    write_launch_context "launch_command_exited" "$exit_code"
    if [[ -n "$app_pid" ]]; then
      echo "Recorded app PID: $app_pid"
      echo "Terminate command: xcrun devicectl device process terminate --device $device --pid $app_pid --kill"
    else
      echo "No app PID found in launch JSON: $launch_json"
    fi
    echo "Launch command exited with code: $exit_code"
    echo "Status file: $status_file"
    echo "Current run context: $current_context_file"
    "$script_dir/filter-runtime-log.sh" --log "$console_log" --process "$process_name" --bundle-id "$bundle_id" --tail 80 || true
    exit "$exit_code"
  fi
fi
