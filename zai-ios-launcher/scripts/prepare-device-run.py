#!/usr/bin/env python3
import argparse
import re
import subprocess
import sys
from pathlib import Path


HELP = "Prepare a generic iOS project for a confirmed real-device run."


def run_text(args):
    try:
        return subprocess.run(args, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout
    except FileNotFoundError:
        return ""


def list_devices():
    output = run_text(["xcrun", "devicectl", "list", "devices"])
    devices = []
    for line in output.splitlines():
        match = re.search(r"([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})", line)
        if match:
            identifier = match.group(1)
            name = line[: match.start()].strip()
            state = "available" if " available " in f" {line} " else "unavailable"
            devices.append((name, identifier, state, line.strip()))
    return output, devices


def discover_xcodeprojs(root):
    ignored = {".git"}
    projects = []
    for path in root.rglob("*.xcodeproj"):
        if ignored.intersection(path.parts):
            continue
        pbxproj = path / "project.pbxproj"
        if pbxproj.exists():
            projects.append(path)
    return sorted(projects)


def choose_xcodeproj(projects):
    if not projects:
        raise SystemExit("No .xcodeproj with project.pbxproj found.")
    if len(projects) == 1:
        return projects[0]
    if not sys.stdin.isatty():
        print("Multiple .xcodeproj candidates found:", file=sys.stderr)
        for path in projects:
            print(f"  - {path}", file=sys.stderr)
        raise SystemExit("Pass --xcodeproj or --pbxproj explicitly.")
    print("Available .xcodeproj candidates:")
    for index, path in enumerate(projects, 1):
        print(f"  {index}. {path}")
    raw = input("Select xcodeproj by number: ").strip()
    if raw.isdigit():
        idx = int(raw)
        if 1 <= idx <= len(projects):
            return projects[idx - 1]
    raise SystemExit(f"Invalid xcodeproj selection: {raw}")


def prompt_choice(devices):
    available = [device for device in devices if device[2] == "available"]
    choices = available or devices
    if not choices:
        raise SystemExit("No CoreDevice devices found.")
    if not sys.stdin.isatty():
        print("Available devices:", file=sys.stderr)
        for name, identifier, state, _ in choices:
            print(f"  - {name} ({identifier}) [{state}]", file=sys.stderr)
        raise SystemExit("Pass --device explicitly.")
    print("Available devices:")
    for index, (name, identifier, state, _) in enumerate(choices, 1):
        print(f"  {index}. {name} ({identifier}) [{state}]")
    raw = input("Select device by number or input device identifier: ").strip()
    if raw.isdigit():
        idx = int(raw)
        if 1 <= idx <= len(choices):
            return choices[idx - 1][1]
    if any(raw == identifier for _, identifier, _, _ in choices):
        return raw
    raise SystemExit(f"Invalid device selection: {raw}")


def read_current_bundle_ids(pbxproj_text):
    return sorted(set(re.findall(r"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);", pbxproj_text)))


def read_current_dev_teams(pbxproj_text):
    values = re.findall(r"\b(?:DEVELOPMENT_TEAM|DevelopmentTeam) = ([^;]+);", pbxproj_text)
    return sorted(set(value.strip().strip('"') for value in values if value.strip().strip('"')))


def clean_pbx_value(value):
    return value.strip().strip('"')


def find_application_configuration_ids(pbxproj_text):
    configuration_list_ids = set()
    target_pattern = re.compile(
        r"^\s*[A-Z0-9]+ /\* [^*]+ \*/ = {\n"
        r"\s*isa = PBXNativeTarget;\n"
        r"(.*?)"
        r"^\s*};",
        re.S | re.M,
    )
    for match in target_pattern.finditer(pbxproj_text):
        body = match.group(1)
        if not re.search(r"productType = \"?com\.apple\.product-type\.application\"?;", body):
            continue
        list_match = re.search(r"\bbuildConfigurationList = ([A-Z0-9]+) ", body)
        if list_match:
            configuration_list_ids.add(list_match.group(1))

    configuration_ids = set()
    for list_id in configuration_list_ids:
        list_pattern = re.compile(
            rf"^\s*{re.escape(list_id)} /\* [^*]+ \*/ = {{\n"
            r"(.*?)"
            r"^\s*};",
            re.S | re.M,
        )
        list_match = list_pattern.search(pbxproj_text)
        if not list_match:
            continue
        configuration_ids.update(re.findall(r"^\s*([A-Z0-9]+) /\* [^*]+ \*/;", list_match.group(1), flags=re.M))
    return configuration_ids


def iter_build_settings(text):
    lines = text.splitlines(keepends=True)
    index = 0
    while index < len(lines):
        start_match = re.match(r"^\s*([A-Z0-9]+) /\* [^*]+ \*/ = \{\s*$", lines[index])
        if not start_match or index + 1 >= len(lines) or "isa = XCBuildConfiguration;" not in lines[index + 1]:
            index += 1
            continue

        depth = 0
        end = index
        while end < len(lines):
            depth += lines[end].count("{") - lines[end].count("}")
            end += 1
            if depth == 0:
                break

        block_lines = lines[index:end]
        settings_start = None
        settings_end = None
        for offset, line in enumerate(block_lines):
            if "buildSettings = {" not in line:
                continue
            settings_start = offset
            settings_depth = 0
            for settings_offset in range(offset, len(block_lines)):
                settings_depth += block_lines[settings_offset].count("{") - block_lines[settings_offset].count("}")
                if settings_depth == 0:
                    settings_end = settings_offset
                    break
            break

        if settings_start is not None and settings_end is not None:
            yield start_match.group(1), "".join(block_lines[settings_start + 1 : settings_end])
        index = end


def read_app_code_sign_identities(pbxproj_text, configuration_ids):
    values = set()
    for config_id, settings in iter_build_settings(pbxproj_text):
        if configuration_ids and config_id not in configuration_ids:
            continue
        if not configuration_ids and not is_app_build_settings(settings):
            continue
        for value in re.findall(r'"?CODE_SIGN_IDENTITY(?:\[sdk=iphoneos\*\])?"? = ([^;]+);', settings):
            clean = clean_pbx_value(value)
            values.add(clean if clean else "")
    return sorted(values)


def is_app_build_settings(settings_text):
    return "PRODUCT_BUNDLE_IDENTIFIER =" in settings_text and "WRAPPER_EXTENSION = app;" in settings_text


def prompt_bundle(default_bundle_id):
    if not sys.stdin.isatty():
        raise SystemExit("Pass --bundle-id explicitly to change or confirm Bundle Identifier.")
    raw = input(f"Confirm Bundle Identifier [{default_bundle_id}]: ").strip()
    return raw or default_bundle_id


def read_identity_team_id(common_name):
    certificate = subprocess.run(
        ["security", "find-certificate", "-c", common_name, "-p"],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if certificate.returncode != 0 or not certificate.stdout:
        return None
    subject = subprocess.run(
        ["openssl", "x509", "-noout", "-subject"],
        input=certificate.stdout,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    if subject.returncode != 0:
        return None
    match = re.search(r"(?:/|, )OU\s*=\s*([A-Z0-9]{10})\b", subject.stdout)
    return match.group(1) if match else None


def find_codesigning_teams():
    output = run_text(["security", "find-identity", "-v", "-p", "codesigning"])
    teams = {}
    for line in output.splitlines():
        match = re.search(r'"([^"]+)"', line)
        if match:
            common_name = match.group(1)
            team_id = read_identity_team_id(common_name)
            if not team_id:
                fallback = re.search(r"\(([A-Z0-9]{10})\)", common_name)
                team_id = fallback.group(1) if fallback else None
            if team_id:
                teams.setdefault(team_id, set()).add(f"identity: {common_name}")
    return teams


def find_profile_teams():
    teams = {}
    profile_dirs = [
        Path.home() / "Library/MobileDevice/Provisioning Profiles",
        Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
    ]
    for profile_dir in profile_dirs:
        if not profile_dir.exists():
            continue
        for profile in sorted(profile_dir.glob("*.mobileprovision")):
            xml = run_text(["security", "cms", "-D", "-i", str(profile)])
            team_matches = re.findall(r"<key>TeamIdentifier</key>\s*<array>\s*<string>([^<]+)</string>", xml, flags=re.S)
            name_match = re.search(r"<key>Name</key>\s*<string>([^<]+)</string>", xml)
            team_name = name_match.group(1) if name_match else profile.name
            for team_id in team_matches:
                teams.setdefault(team_id, set()).add(f"profile: {team_name}")
    return teams


def find_local_dev_teams():
    teams = {}
    for source in (find_codesigning_teams(), find_profile_teams()):
        for team_id, values in source.items():
            teams.setdefault(team_id, set()).update(values)
    return {team_id: sorted(values) for team_id, values in sorted(teams.items())}


def print_local_dev_teams(teams):
    if not teams:
        print("No local Development Team found from codesigning identities or provisioning profiles.")
        return
    print("Local Development Teams:")
    for team_id, sources in teams.items():
        print(f"  - {team_id}")
        for source in sources:
            print(f"      {source}")


def choose_dev_team(teams, yes=False, dry_run=False):
    if not teams:
        raise SystemExit("No local Development Team found. Install an Apple Development certificate/profile or pass --dev-team.")
    if len(teams) == 1:
        team_id = next(iter(teams))
        print_local_dev_teams(teams)
        if not yes and not dry_run:
            if not sys.stdin.isatty():
                raise SystemExit(f"Pass --dev-team {team_id} --yes to use the discovered Development Team.")
            raw = input(f"Use Development Team {team_id}? [y/N] ").strip().lower()
            if raw not in {"y", "yes"}:
                raise SystemExit("Development team confirmation cancelled.")
        return team_id
    print_local_dev_teams(teams)
    if not sys.stdin.isatty():
        raise SystemExit("Multiple local Development Teams found. Pass --dev-team explicitly.")
    choices = list(teams)
    raw = input("Select Development Team by number or input Development Team ID: ").strip()
    if raw.isdigit():
        idx = int(raw)
        if 1 <= idx <= len(choices):
            return choices[idx - 1]
    if raw in teams:
        return raw
    raise SystemExit(f"Invalid Development Team selection: {raw}")


def remove_iap_capability(text):
    new_text = re.sub(
        r"\n\s*com\.apple\.InAppPurchase = \{\n\s*enabled = [01];\n\s*\};",
        "",
        text,
    )
    return new_text, new_text != text


def update_development_team(text, team_id, update_non_empty=False):
    original = text

    def replace_team(match):
        prefix, value, suffix = match.groups()
        clean = clean_pbx_value(value)
        if clean and clean != team_id and not update_non_empty:
            return match.group(0)
        return f"{prefix}{team_id}{suffix}"

    text = re.sub(r"(\bDevelopmentTeam = )([^;]*)(;)", replace_team, text)
    text = re.sub(r"(\bDEVELOPMENT_TEAM = )([^;]*)(;)", replace_team, text)

    block_pattern = re.compile(r"(buildSettings = \{\n)(.*?)(\n\s*\};)", re.S)

    def add_build_setting(match):
        start, body, end = match.groups()
        if "PRODUCT_BUNDLE_IDENTIFIER =" not in body or "DEVELOPMENT_TEAM =" in body:
            return match.group(0)
        product_match = re.search(r"^(\s*)PRODUCT_BUNDLE_IDENTIFIER =", body, flags=re.M)
        if not product_match:
            return match.group(0)
        indent = product_match.group(1)
        insert = f"{indent}DEVELOPMENT_TEAM = {team_id};\n"
        body = body[: product_match.start()] + insert + body[product_match.start() :]
        return start + body + end

    text = block_pattern.sub(add_build_setting, text)
    return text, text != original


def update_code_sign_identity(text, identity, update_non_empty=False):
    original = text
    application_configuration_ids = find_application_configuration_ids(text)
    lines = text.splitlines(keepends=True)
    new_lines = []
    index = 0

    while index < len(lines):
        start_match = re.match(r"^\s*([A-Z0-9]+) /\* [^*]+ \*/ = \{\s*$", lines[index])
        if not start_match or index + 1 >= len(lines) or "isa = XCBuildConfiguration;" not in lines[index + 1]:
            new_lines.append(lines[index])
            index += 1
            continue

        depth = 0
        end = index
        while end < len(lines):
            depth += lines[end].count("{") - lines[end].count("}")
            end += 1
            if depth == 0:
                break

        block_lines = lines[index:end]
        config_id = start_match.group(1)
        settings_start = None
        settings_end = None
        for offset, line in enumerate(block_lines):
            if "buildSettings = {" not in line:
                continue
            settings_start = offset
            settings_depth = 0
            for settings_offset in range(offset, len(block_lines)):
                settings_depth += block_lines[settings_offset].count("{") - block_lines[settings_offset].count("}")
                if settings_depth == 0:
                    settings_end = settings_offset
                    break
            break

        should_update = False
        if settings_start is not None and settings_end is not None:
            settings_text = "".join(block_lines[settings_start + 1 : settings_end])
            should_update = (
                config_id in application_configuration_ids
                if application_configuration_ids
                else is_app_build_settings(settings_text)
            )

        if should_update:
            settings_lines = block_lines[settings_start + 1 : settings_end]
            updated_settings, _ = ensure_code_sign_identity_settings(settings_lines, identity, update_non_empty=update_non_empty)
            block_lines = block_lines[: settings_start + 1] + updated_settings + block_lines[settings_end:]

        new_lines.extend(block_lines)
        index = end

    text = "".join(new_lines)
    return text, text != original


def should_replace_identity(value, identity, update_non_empty=False):
    clean = clean_pbx_value(value)
    if clean == identity:
        return False
    if update_non_empty:
        return True
    return clean in {"", "iPhone Developer"}


def make_code_sign_line(indent, key, identity, newline="\n"):
    if key == "sdk":
        return f'{indent}"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "{identity}";{newline}'
    return f'{indent}CODE_SIGN_IDENTITY = "{identity}";{newline}'


def replace_setting_line(line, identity, key):
    newline = "\n" if line.endswith("\n") else ""
    pattern = r'^(\s*)"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]" = ([^;]*);(.*?)(\n?)$' if key == "sdk" else r'^(\s*)CODE_SIGN_IDENTITY = ([^;]*);(.*?)(\n?)$'
    match = re.match(pattern, line)
    if not match:
        return line
    suffix = match.group(3)
    return make_code_sign_line(match.group(1), key, identity, "") + suffix + newline


def ensure_code_sign_identity_settings(settings_lines, identity, update_non_empty=False):
    lines = list(settings_lines)
    changed = False
    plain_index = None
    sdk_index = None
    plain_value = None
    sdk_value = None

    for index, line in enumerate(lines):
        plain_match = re.match(r"^(\s*)CODE_SIGN_IDENTITY = ([^;]*);", line)
        if plain_match:
            plain_index = index
            plain_value = plain_match.group(2)
            continue
        sdk_match = re.match(r'^(\s*)"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]" = ([^;]*);', line)
        if sdk_match:
            sdk_index = index
            sdk_value = sdk_match.group(2)

    if plain_index is not None and should_replace_identity(plain_value, identity, update_non_empty=update_non_empty):
        lines[plain_index] = replace_setting_line(lines[plain_index], identity, "plain")
        plain_value = f'"{identity}"'
        changed = True

    if sdk_index is not None and should_replace_identity(sdk_value, identity, update_non_empty=update_non_empty):
        lines[sdk_index] = replace_setting_line(lines[sdk_index], identity, "sdk")
        sdk_value = f'"{identity}"'
        changed = True

    insertions = []
    indent = None
    for line in lines:
        indent_match = re.match(r"^(\s*)[A-Z_]+.* = ", line)
        if indent_match:
            indent = indent_match.group(1)
            break
    indent = indent or "\t\t\t\t"

    if plain_index is None:
        insertions.append(make_code_sign_line(indent, "plain", identity))
    if sdk_index is None and (plain_index is None or clean_pbx_value(plain_value) in {"", identity, "iPhone Developer"}):
        insertions.append(make_code_sign_line(indent, "sdk", identity))

    if insertions:
        insert_at = None
        if plain_index is not None:
            insert_at = plain_index + 1
        else:
            for index, line in enumerate(lines):
                if re.match(r'^\s*"CODE_SIGN_IDENTITY\[sdk=iphoneos\*\]" = ', line):
                    insert_at = index
                    break
        if insert_at is None:
            for index, line in enumerate(lines):
                if re.match(r"^\s*(DEVELOPMENT_TEAM|PRODUCT_BUNDLE_IDENTIFIER) = ", line):
                    insert_at = index
                    break
        if insert_at is None:
            insert_at = 0
        lines[insert_at:insert_at] = insertions
        changed = True

    return lines, changed


def main():
    parser = argparse.ArgumentParser(description=HELP)
    parser.add_argument("--project", "-p", default=".", help="Repository/project root")
    parser.add_argument("--xcodeproj", help="Selected .xcodeproj path")
    parser.add_argument("--pbxproj", help="Selected project.pbxproj path")
    parser.add_argument("--device", help="Confirmed device identifier")
    parser.add_argument("--bundle-id", help="Confirmed Bundle Identifier")
    parser.add_argument("--dev-team", help="Confirmed Apple Development Team ID")
    parser.add_argument("--auto-dev-team", action="store_true", help="If the project has no Development Team, discover local Development Teams and use the confirmed choice")
    parser.add_argument("--print-local-dev-teams", action="store_true", help="Print local Development Teams from codesigning identities and provisioning profiles, then exit")
    parser.add_argument("--update-all-bundle-ids", action="store_true", help="Allow replacing multiple unique PRODUCT_BUNDLE_IDENTIFIER values")
    parser.add_argument("--update-all-dev-teams", action="store_true", help="Allow replacing non-empty DEVELOPMENT_TEAM/DevelopmentTeam values")
    parser.add_argument("--code-sign-identity", default="Apple Development", help="Set missing/empty app-target CODE_SIGN_IDENTITY. Default: Apple Development")
    parser.add_argument("--skip-code-sign-identity", action="store_true", help="Do not update app-target CODE_SIGN_IDENTITY")
    parser.add_argument("--update-all-code-sign-identities", action="store_true", help="Allow replacing non-empty app-target CODE_SIGN_IDENTITY values")
    parser.add_argument("--remove-iap", action="store_true", help="Remove com.apple.InAppPurchase capability when present")
    parser.add_argument("--yes", action="store_true", help="Assume the discovered/selected Development Team was already confirmed by the user")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
    args = parser.parse_args()

    if args.print_local_dev_teams:
        print_local_dev_teams(find_local_dev_teams())
        return

    project = Path(args.project).expanduser().resolve()
    if not project.exists():
        raise SystemExit(f"Project root does not exist: {project}")

    if args.pbxproj:
        pbxproj = Path(args.pbxproj).expanduser().resolve()
    else:
        if args.xcodeproj:
            xcodeproj = Path(args.xcodeproj).expanduser().resolve()
        else:
            xcodeproj = choose_xcodeproj(discover_xcodeprojs(project))
        pbxproj = xcodeproj / "project.pbxproj"

    if not pbxproj.exists():
        raise SystemExit(f"project.pbxproj not found: {pbxproj}")

    device_output, devices = list_devices()
    if args.device:
        device_id = args.device
    else:
        if devices:
            device_id = prompt_choice(devices)
        else:
            print(device_output.strip())
            raise SystemExit("No CoreDevice device found.")

    text = pbxproj.read_text()
    bundle_ids = read_current_bundle_ids(text)
    if not bundle_ids:
        raise SystemExit(f"No PRODUCT_BUNDLE_IDENTIFIER found in {pbxproj}")

    application_configuration_ids = find_application_configuration_ids(text)
    current_code_sign_identities = read_app_code_sign_identities(text, application_configuration_ids)
    current_dev_teams = read_current_dev_teams(text)
    default_bundle_id = bundle_ids[0]
    target_bundle_id = args.bundle_id
    if target_bundle_id is None and sys.stdin.isatty():
        target_bundle_id = prompt_bundle(default_bundle_id)
    elif target_bundle_id is None:
        target_bundle_id = default_bundle_id

    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9.$_()-]*(?:\.[A-Za-z0-9.$_()-]+)*$", target_bundle_id):
        raise SystemExit(f"Invalid Bundle Identifier: {target_bundle_id}")

    target_dev_team = args.dev_team
    if target_dev_team and not re.match(r"^[A-Z0-9]{10}$", target_dev_team):
        raise SystemExit(f"Invalid Development Team ID: {target_dev_team}")
    if not target_dev_team:
        if current_dev_teams:
            if len(current_dev_teams) > 1:
                raise SystemExit(f"Multiple Development Teams already set: {', '.join(current_dev_teams)}")
            target_dev_team = current_dev_teams[0]
        elif args.auto_dev_team:
            target_dev_team = choose_dev_team(find_local_dev_teams(), yes=args.yes, dry_run=args.dry_run)

    new_text = text
    bundle_changed = False
    should_update_bundle = target_bundle_id not in bundle_ids or len(bundle_ids) > 1
    if should_update_bundle:
        if len(bundle_ids) > 1 and not args.update_all_bundle_ids:
            print("Multiple unique Bundle Identifiers found:", file=sys.stderr)
            for bundle_id in bundle_ids:
                print(f"  - {bundle_id}", file=sys.stderr)
            raise SystemExit("Pass --update-all-bundle-ids only after confirming all entries should use the same Bundle Identifier.")
        new_text = re.sub(r"PRODUCT_BUNDLE_IDENTIFIER = [^;]+;", f"PRODUCT_BUNDLE_IDENTIFIER = {target_bundle_id};", new_text)
        bundle_changed = new_text != text

    dev_team_changed = False
    if target_dev_team:
        existing_after_bundle = read_current_dev_teams(new_text)
        if existing_after_bundle and any(team != target_dev_team for team in existing_after_bundle) and not args.update_all_dev_teams:
            raise SystemExit(
                "Existing Development Team differs from requested Development Team. "
                "Pass --update-all-dev-teams only after confirming the replacement."
            )
        new_text, dev_team_changed = update_development_team(new_text, target_dev_team, update_non_empty=args.update_all_dev_teams)

    code_sign_changed = False
    if not args.skip_code_sign_identity and args.code_sign_identity:
        new_text, code_sign_changed = update_code_sign_identity(
            new_text,
            args.code_sign_identity,
            update_non_empty=args.update_all_code_sign_identities,
        )

    iap_changed = False
    if args.remove_iap:
        new_text, iap_changed = remove_iap_capability(new_text)

    print(f"Project file: {pbxproj}")
    print(f"Device: {device_id}")
    print(f"Bundle Identifier: {target_bundle_id}")
    print(f"Existing Bundle Identifiers: {', '.join(bundle_ids)}")
    print(f"Development Team: {target_dev_team or '(not set)'}")
    print(f"Existing Development Teams: {', '.join(current_dev_teams) if current_dev_teams else '(none)'}")
    print(f"Code Sign Identity: {args.code_sign_identity if not args.skip_code_sign_identity else '(skipped)'}")
    print(f"Existing app Code Sign Identities: {', '.join(current_code_sign_identities) if current_code_sign_identities else '(none)'}")
    print(f"Bundle Identifier changed: {'yes' if bundle_changed else 'no'}")
    print(f"Development team changed: {'yes' if dev_team_changed else 'no'}")
    print(f"Code sign identity changed: {'yes' if code_sign_changed else 'no'}")
    if args.remove_iap:
        print(f"In-App Purchase capability removed: {'yes' if iap_changed else 'not found'}")
    else:
        print("In-App Purchase capability cleanup: skipped")

    if args.dry_run:
        print("Dry run: no files written.")
        return

    if new_text != text:
        pbxproj.write_text(new_text)
        validation = subprocess.run(["plutil", "-lint", str(pbxproj)], check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(validation.stdout.strip())
        if validation.returncode != 0:
            raise SystemExit(validation.returncode)
    else:
        print("No project file changes needed.")


if __name__ == "__main__":
    main()
