#!/bin/bash
# extract_meta.sh - APK 富元信息抓取（v3）
# 用法：extract_meta.sh <apk> > meta.json
# 工具链：
#   - apkanalyzer（Android SDK cmdline-tools）- Manifest XML 全量
#   - apksigner（Android SDK build-tools 30+）- 签名证书
#   - aapt（build-tools 30+）- 兜底
# 输出：单一 JSON，符合 plan 中定义的富 schema

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -f "$SKILL_DIR/scripts/lib/_common.sh" ]; then
  source "$SKILL_DIR/scripts/lib/_common.sh"
else
  source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
fi

APK="${1:?用法: extract_meta.sh <apk>}"
[ -f "$APK" ] || die "APK not found: $APK"

APKANALYZER=$(find_tool apkanalyzer) || die "apkanalyzer 未找到。装 Android SDK cmdline-tools"
APKSIGNER=$(find_tool apksigner)   || warn "apksigner 未找到，签名信息将留空"
AAPT=$(find_tool aapt)             || warn "aapt 未找到"

log "extract_meta: $APK"

# ============================================================
# 1. Manifest XML 全量
# ============================================================
MANXML=$(mktemp)
trap 'rm -f "$MANXML"' EXIT

"$APKANALYZER" manifest print "$APK" 2>/dev/null > "$MANXML"
# Fallback: androguard when apkanalyzer fails (e.g. Java 17+ missing javax.xml.bind)
if [ ! -s "$MANXML" ]; then
  log "apkanalyzer 失败，尝试 androguard fallback..."
  python3 - "$APK" > "$MANXML" << 'PYEOF'
import sys, logging, os
os.environ['LOGURU_LEVEL'] = 'CRITICAL'
logging.disable(logging.CRITICAL)
try:
    from loguru import logger; logger.remove()
except Exception:
    pass
from androguard.core.apk import APK
a = APK(sys.argv[1])
axml = a.get_android_manifest_axml()
xml_str = axml.get_xml().decode('utf-8') if isinstance(axml.get_xml(), bytes) else axml.get_xml()
print(xml_str)
PYEOF
fi
[ ! -s "$MANXML" ] && die "无法解析 manifest (apkanalyzer + androguard 均失败)"

# ============================================================
# 2. apksigner verify --print-certs
# ============================================================
SIGNINFO=""
if [ -n "$APKSIGNER" ]; then
  SIGNINFO=$("$APKSIGNER" verify --print-certs --verbose "$APK" 2>/dev/null || echo "")
fi

# ============================================================
# 3. assets / libs / dex 清单
# ============================================================
ASSETS=$(unzip -l "$APK" 2>/dev/null | awk '$NF ~ /^assets\// {print $1 "\t" $NF}')
LIBS=$(unzip -l "$APK" 2>/dev/null | awk '$NF ~ /^lib\// {print $1 "\t" $NF}')
DEX_COUNT=$(unzip -l "$APK" 2>/dev/null | grep -cE "classes[0-9]*\.dex")

# ============================================================
# 4. SDK 画像（从 strings 兜底）
# ============================================================
SDK_HINTS=$(unzip -p "$APK" classes.dex 2>/dev/null | strings 2>/dev/null \
  | grep -oE "com/(tencent|alibaba|umeng|amap|baidu|huawei|xiaomi|jiguang|getui|bytedance|alipay|tmall|taobao|pdd|xunmeng|aweme|tt[a-z]+|microsoft|google|sentry|bugsnag|firebase|appsflyer)/[a-zA-Z0-9_/.-]*" 2>/dev/null \
  | head -200 | awk -F'/' '{print $1"/"$2}' | sort -u | head -40 || echo "")

# ============================================================
# 5. 加固识别（用 v2 detect_packer 的简化逻辑）
# ============================================================
PACKER_NAME="none"
PACKER_EVID=""
SO_LIST=$(echo "$LIBS" | awk '{print $2}')
if echo "$SO_LIST" | grep -qE "libjiagu|libjiagu_64|libjiagu_a64"; then
  PACKER_NAME="360加固"; PACKER_EVID="libjiagu*.so"
elif echo "$SO_LIST" | grep -qE "libsecexe|libsecmain|libSecShell"; then
  PACKER_NAME="爱加密"; PACKER_EVID="libsec*.so"
elif echo "$SO_LIST" | grep -qE "libtup|libshellx"; then
  PACKER_NAME="腾讯乐固/御安全"; PACKER_EVID="libtup/libshellx"
elif echo "$SO_LIST" | grep -qE "libmobisec|libfakejni|libpreverify"; then
  PACKER_NAME="阿里聚安全"; PACKER_EVID="libmobisec/libfakejni"
elif echo "$SO_LIST" | grep -qE "libDexHelper|libbangcleplugin"; then
  PACKER_NAME="梆梆加固"; PACKER_EVID="libDexHelper"
elif echo "$SO_LIST" | grep -qE "libDexProtector"; then
  PACKER_NAME="DexProtector"; PACKER_EVID="libDexProtector"
elif echo "$SO_LIST" | grep -qE "libpdd_secure|libpinduoduo_secure"; then
  PACKER_NAME="拼多多自研"; PACKER_EVID="libpdd_secure"
fi

# ============================================================
# 6. 全部交给 Python 解析 XML -> JSON
# ============================================================
APK_SIZE=$(stat -f %z "$APK" 2>/dev/null || stat -c %s "$APK")
APK_SHA256=$(shasum -a 256 "$APK" 2>/dev/null | awk '{print $1}' || sha256sum "$APK" 2>/dev/null | awk '{print $1}')

# 把环境变量喂给 python（避免命令行参数被 shell 截断）
export ASSETS_RAW="$ASSETS"
export LIBS_RAW="$LIBS"
export SIGNINFO
export SDK_HINTS

python3 - "$APK" "$APK_SIZE" "$APK_SHA256" "$MANXML" "$DEX_COUNT" "$PACKER_NAME" "$PACKER_EVID" << 'PYEOF'
import sys, json, os, re
from xml.etree import ElementTree as ET

apk_path, apk_size, apk_sha256, man_xml, dex_count, packer_name, packer_evid = sys.argv[1:8]

# 读 Android namespace 处理
NS = '{http://schemas.android.com/apk/res/android}'

try:
    tree = ET.parse(man_xml)
    root = tree.getroot()
except Exception as e:
    print(json.dumps({'error': f'parse manifest: {e}'}), file=sys.stderr)
    sys.exit(1)

pkg = root.get('package', '')
version_name = root.get(NS + 'versionName', '')
version_code = root.get(NS + 'versionCode', '')
compile_sdk = root.get(NS + 'compileSdkVersion', '')

uses_sdk = root.find('uses-sdk')
min_sdk = uses_sdk.get(NS + 'minSdkVersion') if uses_sdk is not None else ''
target_sdk = uses_sdk.get(NS + 'targetSdkVersion') if uses_sdk is not None else ''

# 危险权限名单（Google 官方 dangerous level）
DANGEROUS = set((
    'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
    'ACCESS_BACKGROUND_LOCATION', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS',
    'READ_CALENDAR', 'WRITE_CALENDAR', 'READ_SMS', 'SEND_SMS', 'RECEIVE_SMS', 'READ_PHONE_STATE',
    'READ_PHONE_NUMBERS', 'CALL_PHONE', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'PROCESS_OUTGOING_CALLS',
    'ANSWER_PHONE_CALLS', 'ADD_VOICEMAIL', 'USE_SIP', 'BODY_SENSORS', 'ACTIVITY_RECOGNITION',
    'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_AUDIO', 'READ_MEDIA_VIDEO',
))

permissions = []
for p in root.findall('uses-permission'):
    name = p.get(NS + 'name', '')
    short = name.split('.')[-1]
    permissions.append({
        'name': name,
        'level': 'dangerous' if short in DANGEROUS else 'normal',
    })

# Application 标签
app = root.find('application')
app_info = {}
if app is not None:
    app_info = {
        'name': app.get(NS + 'name', ''),
        'allow_backup': app.get(NS + 'allowBackup', 'true') == 'true',
        'uses_cleartext_traffic': app.get(NS + 'usesCleartextTraffic', 'false') == 'true',
        'network_security_config': app.get(NS + 'networkSecurityConfig', ''),
        'debuggable': app.get(NS + 'debuggable', 'false') == 'true',
    }

# 组件（activity / service / provider / receiver）
def parse_component(comp, comp_type):
    info = {
        'name': comp.get(NS + 'name', ''),
        'exported': comp.get(NS + 'exported', 'false') == 'true',
    }
    # provider 独有 authorities
    if comp_type == 'provider':
        info['authorities'] = comp.get(NS + 'authorities', '')
        info['grant_uri_permissions'] = comp.get(NS + 'grantUriPermissions', 'false') == 'true'
    # intent-filters
    filters = []
    for f in comp.findall('intent-filter'):
        actions = [a.get(NS + 'name', '') for a in f.findall('action')]
        categories = [c.get(NS + 'name', '') for c in f.findall('category')]
        data_list = []
        for d in f.findall('data'):
            d_info = {}
            for k in ['scheme', 'host', 'port', 'path', 'pathPrefix', 'pathPattern', 'mimeType']:
                v = d.get(NS + k, '')
                if v:
                    d_info[k] = v
            if d_info:
                data_list.append(d_info)
        if actions or categories or data_list:
            filters.append({'actions': actions, 'categories': categories, 'data': data_list})
    if filters:
        info['intent_filters'] = filters
    return info

components = {
    'activities': [parse_component(c, 'activity') for c in app.findall('activity')] if app is not None else [],
    'services': [parse_component(c, 'service') for c in app.findall('service')] if app is not None else [],
    'providers': [parse_component(c, 'provider') for c in app.findall('provider')] if app is not None else [],
    'receivers': [parse_component(c, 'receiver') for c in app.findall('receiver')] if app is not None else [],
}

# 启动 activity（有 MAIN + LAUNCHER 的 activity）
launch_activity = ''
for act in components['activities']:
    for f in act.get('intent_filters', []):
        if 'android.intent.action.MAIN' in f.get('actions', []) and \
           'android.intent.category.LAUNCHER' in f.get('categories', []):
            launch_activity = act['name']
            break
    if launch_activity:
        break

# Deeplinks（所有 intent-filter 含 BROWSABLE + scheme）
deeplinks = []
seen_dl = set()
for ctype in ['activities']:
    for c in components[ctype]:
        for f in c.get('intent_filters', []):
            if 'android.intent.category.BROWSABLE' not in f.get('categories', []):
                continue
            for d in f.get('data', []):
                scheme = d.get('scheme', '')
                host = d.get('host', '')
                if not scheme:
                    continue
                key = f"{scheme}://{host}/{c['name']}"
                if key in seen_dl:
                    continue
                seen_dl.add(key)
                deeplinks.append({
                    'scheme': scheme,
                    'host': host,
                    'activity': c['name'],
                    'path': d.get('path', '') or d.get('pathPrefix', '') or d.get('pathPattern', ''),
                    'mimeType': d.get('mimeType', ''),
                })

# Queries（targetSdk 33+ 必须声明的可见包）
queries = []
q = root.find('queries')
if q is not None:
    for p in q.findall('package'):
        n = p.get(NS + 'name', '')
        if n:
            queries.append(n)

# Libs / assets / dex
libs_raw = os.environ.get('LIBS_RAW', '')
assets_raw = os.environ.get('ASSETS_RAW', '')
def parse_file_list(raw):
    out = []
    for line in raw.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        parts = line.split('\t') if '\t' in line else line.split(None, 1)
        if len(parts) >= 2:
            try:
                size = int(parts[0])
            except Exception:
                size = 0
            path = parts[1]
            abi = ''
            if path.startswith('lib/'):
                bits = path.split('/')
                abi = bits[1] if len(bits) > 2 else ''
            entry = {'path': path, 'size': size}
            if abi:
                entry['abi'] = abi
            out.append(entry)
    return out

libs = parse_file_list(libs_raw)
assets = parse_file_list(assets_raw)

# 签名信息
sign_info = {}
sign_raw = os.environ.get('SIGNINFO', '')
if sign_raw:
    # apksigner 输出格式
    m_v1 = re.search(r'Verified using v1 scheme \(JAR signing\):\s*(true|false)', sign_raw)
    m_v2 = re.search(r'Verified using v2 scheme \(APK Signature Scheme v2\):\s*(true|false)', sign_raw)
    m_v3 = re.search(r'Verified using v3 scheme \(APK Signature Scheme v3\):\s*(true|false)', sign_raw)
    m_v4 = re.search(r'Verified using v4 scheme \(APK Signature Scheme v4\):\s*(true|false)', sign_raw)
    m_cn = re.search(r'Signer #\d+ certificate DN:\s*(.+)', sign_raw)
    m_sha = re.search(r'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F:]+)', sign_raw)
    sign_info = {
        'v1': (m_v1.group(1) == 'true') if m_v1 else None,
        'v2': (m_v2.group(1) == 'true') if m_v2 else None,
        'v3': (m_v3.group(1) == 'true') if m_v3 else None,
        'v4': (m_v4.group(1) == 'true') if m_v4 else None,
        'cert_subject': m_cn.group(1).strip() if m_cn else '',
        'cert_sha256': m_sha.group(1) if m_sha else '',
        'is_debug': bool(m_cn) and 'Android Debug' in m_cn.group(1),
    }

# SDK hints
sdk_hints = os.environ.get('SDK_HINTS', '').strip().split('\n')
sdk_hints = [s for s in sdk_hints if s]

def to_int(value):
    return int(value) if isinstance(value, str) and value.isdigit() else value

result = {
    'apk_path': apk_path,
    'apk_size': int(apk_size),
    'sha256': apk_sha256,
    'package': pkg,
    'version_name': version_name,
    'version_code': version_code,
    'min_sdk': to_int(min_sdk),
    'target_sdk': to_int(target_sdk),
    'compile_sdk': to_int(compile_sdk),
    'dex_count': int(dex_count),
    'signing': sign_info,
    'application': app_info,
    'permissions': permissions,
    'components_summary': {
        'activities': len(components['activities']),
        'services': len(components['services']),
        'providers': len(components['providers']),
        'receivers': len(components['receivers']),
        'exported_total': sum(1 for ctype in components for c in components[ctype] if c.get('exported')),
    },
    'components': components,
    'launch_activity': launch_activity,
    'deeplinks': deeplinks,
    'queries': queries,
    'libs': libs,
    'assets_count': len(assets),
    'assets_sample': assets[:30],
    'sdk_hints': sdk_hints,
    'packer': {'name': packer_name, 'evidence': packer_evid},
}

print(json.dumps(result, ensure_ascii=False, indent=2))
PYEOF
