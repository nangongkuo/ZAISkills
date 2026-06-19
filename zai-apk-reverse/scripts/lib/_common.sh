#!/bin/bash
#
# _common.sh - v3 共享工具函数
# source 后可用: find_tool / json_get / log / die / packer_strategy / check_step 等
#
# 加载方法:
#
#   SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
#   source "$SKILL_DIR/scripts/lib/_common.sh"
#
# SKILL_DIR / V3_CONFIG / WORK_ROOT / REPORTS_ROOT / STATE_ROOT 已经准备好

set -u

# ============================================================
# 路径常量（依赖调用者已 export SKILL_DIR；否则尝试自检）
# ============================================================
if [ -z "${SKILL_DIR:-}" ]; then
  SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  export SKILL_DIR
fi
V3_CONFIG="$SKILL_DIR/config.json"
export V3_CONFIG

# 从 config.json 解析路径
_apk_root="$HOME/.apk-reverse"
WORK_ROOT="/tmp"
REPORTS_ROOT="$_apk_root/reports"
INDEXES_ROOT="$_apk_root/indexes"
KNOWLEDGE_ROOT="$_apk_root/knowledge"
STATE_ROOT="$_apk_root/state"
mkdir -p "$REPORTS_ROOT" "$INDEXES_ROOT" "$KNOWLEDGE_ROOT" "$STATE_ROOT"
export WORK_ROOT REPORTS_ROOT INDEXES_ROOT KNOWLEDGE_ROOT STATE_ROOT

# ============================================================
# 日志
# ============================================================
log()  { echo "[$(date +%H:%M:%S)] $*" >&2; }
warn() { echo "[$(date +%H:%M:%S)] ⚠ $*" >&2; }
die()  { echo "[$(date +%H:%M:%S)] ✕ $*" >&2; exit "${2:-1}"; }
ok()   { echo "[$(date +%H:%M:%S)] ✓ $*" >&2; }

# ============================================================
# 架构 / 工具发现
# ============================================================
arch_ok() {
  local p="$1"
  [[ "$OSTYPE" != "darwin"* ]] && return 0
  [[ "$(uname -m)" != "arm64" ]] && return 0
  # script / java / text 类直接 OK
  file "$p" 2>/dev/null | grep -qE "shell|text|script|Java archive|ASCII|Python" && return 0
  # Mach-O 必须含 arm64 或 universal
  file "$p" 2>/dev/null | grep -qE "arm64|universal" && return 0
  return 1
}

find_tool() {
  local cmd="$1"
  # 1. PATH
  if command -v "$cmd" >/dev/null; then
    local p
    p="$(command -v "$cmd")"
    if arch_ok "$p"; then echo "$p"; return 0; fi
  fi
  # 2. 兜底常见安装位置
  local candidates=(
    "$HOME/Library/Android/sdk/cmdline-tools/latest/bin/$cmd"
    "$HOME/Library/Android/sdk/platform-tools/$cmd"
    "$HOME/Library/Android/sdk/build-tools/"*/"$cmd"
    "$HOME/Android/sdk/cmdline-tools/latest/bin/$cmd"
    "$HOME/Android/sdk/platform-tools/$cmd"
    "$HOME/Android/sdk/platform-tools/$cmd"
    "/opt/homebrew/share/android-sdk/platform-tools/$cmd"
    "$HOME/Library/Python/3.13/bin/$cmd"
    "$HOME/Library/Python/3.12/bin/$cmd"
    "$HOME/Library/Python/3.11/bin/$cmd"
    "$HOME/Library/Python/3.10/bin/$cmd"
    "$HOME/Library/Python/3.9/bin/$cmd"
    "$HOME/.local/bin/$cmd"
    "$HOME/.npm-global/bin/$cmd"
    "/opt/homebrew/bin/$cmd"
    "/usr/local/bin/$cmd"
  )

  for p in "${candidates[@]}"; do
    if [ -x "$p" ] && arch_ok "$p"; then
      echo "$p"; return 0
    fi
  done
  return 1
}

require_tool() {
  local name="$1" install_hint="$2"
  local p
  p="$(find_tool "$name" || true)"
  if [ -z "$p" ]; then
    die "工具 $name 未找到。安装: $install_hint"
  fi
  echo "$p"
}

# ============================================================
# JSON 读写（python3 兜底，不依赖 jq）
# ============================================================
json_get() {
  # 用法: json_get <file> <path> [default]
  # 例: json_get meta.json .package
  # 例: json_get meta.json .packer.name none
  local file="$1" path="$2" default="${3:-}"
  local result
  result=$(python3 - "$file" "$path" << 'PYEOF'
import json, sys
file, path = sys.argv[1], sys.argv[2]
try:
    obj = json.load(open(file))
except Exception:
    sys.exit(0)
parts = path.lstrip('.').split('.')
for p in parts:
    if not p:
        continue
    if isinstance(obj, dict):
        obj = obj.get(p)
    elif isinstance(obj, list):
        try:
            obj = obj[int(p)]
        except Exception:
            obj = None
    else:
        obj = None
    if obj is None:
        break
if isinstance(obj, (dict, list)):
    print(json.dumps(obj, ensure_ascii=False))
elif obj is None:
    print('')
else:
    print(obj)
PYEOF
)
  if [ -z "$result" ] && [ -n "$default" ]; then
    echo "$default"
  else
    echo "$result"
  fi
}

# 安全取值：缺失时返回 [N/A] 而非空字符串（用于 render 模板）
json_get_safe() {
  local file="$1" path="$2"
  local val
  val=$(json_get "$file" "$path")
  if [ -z "$val" ] || [ "$val" = "null" ]; then
    echo "[N/A]"
  else
    echo "$val"
  fi
}

json_set() {
  # 用法: json_set <file> <path> <value> 支持新增 key（值始终当字符串）
  local file="$1" path="$2" value="$3"
  python3 - "$file" "$path" "$value" << 'PYEOF'
import json, sys, os
file, path, value = sys.argv[1], sys.argv[2], sys.argv[3]
obj = json.load(open(file)) if os.path.exists(file) else {}
parts = path.lstrip('.').split('.')
target = obj
for p in parts[:-1]:
    if p not in target or not isinstance(target[p], dict):
        target[p] = {}
    target = target[p]
target[parts[-1]] = value
json.dump(obj, open(file, 'w'), ensure_ascii=False, indent=2)
PYEOF
}

# 把 stdin（JSON）写入文件，自动 indent
json_write() {
  local file="$1"
  python3 -c "import json,sys; json.dump(json.load(sys.stdin), open('$file','w'), ensure_ascii=False, indent=2)"
}

# ============================================================
# State（按 package 维度持久化飞书文档 ID / URL 等）
# ============================================================
state_file() {
  local pkg="$1"
  echo "$STATE_ROOT/$pkg.json"
}

state_get() {
  local pkg="$1" path="$2"
  local f
  f=$(state_file "$pkg")
  [ ! -f "$f" ] && echo "" && return
  json_get "$f" "$path"
}

state_set() {
  local pkg="$1" path="$2" value="$3"
  local f
  f=$(state_file "$pkg")
  [ ! -f "$f" ] && echo "{}" > "$f"
  json_set "$f" "$path" "$value"
}

# ============================================================
# Workdir 管理
# ============================================================
new_workdir() {
  local pkg="${1:-unknown}"
  local ts
  ts=$(date +%s)
  local d="$WORK_ROOT/apk-reverse-${pkg}-${ts}"
  mkdir -p "$d"/{evidence/{code,logs,screenshots,bodies},findings,decompiled,unpacked_dex}
  echo "$d"
}

# 从 workdir 读 pkg / version（调用者保证 meta.json 已存在）
workdir_pkg() {
  local wd="$1"
  json_get "$wd/meta.json" '.package'
}

workdir_version() {
  local wd="$1"
  json_get "$wd/meta.json" '.version_name'
}

# ============================================================
# Decision log（每个 workdir 一份）
# ============================================================
decision_log() {
  local wd="$1" msg="$2"
  local f="$wd/decision-log.md"
  if [ ! -f "$f" ]; then
    echo "# Decision Log - $(basename "$wd")" > "$f"
    echo "" >> "$f"
  fi
  echo "" >> "$f"
  echo "**$(date '+%Y-%m-%d %H:%M:%S')** - $msg" >> "$f"
}

# ============================================================
# Resume 支持：检查某个步骤是否已完成（产物文件存在且非空）
# 用法: check_step <workdir> <step_name> <output_file>
# 返回 0 = 已完成（跳过），1 = 需要执行
# ============================================================
check_step() {
  local wd="$1" step="$2" output="$3"
  if [ -s "$output" ]; then
    # 额外检查：decompile 产物是否有 Java 文件
    if [ "$step" = "decompile" ]; then
      local java_count
      java_count=$(find "$output" -name "*.java" 2>/dev/null | wc -l | tr -d ' ')
      if [ "$java_count" -gt 0 ]; then
        log "✓ $step 已完成（产物存在: $output, $java_count Java files），跳过"
        return 0
      else
        warn "$step 产物存在但为空（0 Java files），重新执行"
        rm -rf "$output"
        return 1
      fi
    fi
    local size
    size=$(wc -c < "$output" 2>/dev/null || echo 0)
    if [ "$size" -gt 0 ]; then
      log "✓ $step 已完成（产物存在: $output, ${size}B），跳过"
      return 0
    fi
  fi
  return 1
}

# ============================================================
# 加固策略映射
# 用法: packer_strategy <packer_name>
# 返回: full / partial / java_only / vmp_only / manual
# ============================================================
packer_strategy() {
  local packer="$1"
  case "$packer" in
    360加固|爱加密|百度加固|DexProtector|腾讯乐固|御安全)
      echo "full" ;;
    梆梆加固|梆梆|网易易盾|易盾)
      echo "partial" ;;
    阿里聚安全|libfakejni|拼多多自研|libpdd_secure|libpinduoduo_secure)
      echo "java_only" ;;
    *)
      echo "unknown" ;;
  esac
}

# ============================================================
# 设备环境校验（用于 dynamic.sh 和 unpack.sh）
# 返回 0 = 环境OK，非0 = 缺失
# ============================================================
check_device() {
  local ADB
  ADB=$(find_tool adb || true)
  local errors=0

  if [ -z "$ADB" ]; then
    warn "adb 未找到 - 需要连接 Android 设备/模拟器"
    errors=$((errors+1))
  else
    # 设备是否连接
    local state
    state=$($ADB get-state 2>/dev/null | tr -d '\r\n')
    if [ "$state" != "device" ]; then
      warn "adb 设备未连接（state=$state）- 请启动模拟器或连接手机"
      errors=$((errors+1))
    else
      ok "adb 设备已连接"

      # SELinux 检查
      local selinux
      selinux=$($ADB shell getenforce 2>/dev/null | tr -d '\r\n')
      if [ "$selinux" = "Enforcing" ]; then
        warn "SELinux=Enforcing - 可能阻止 frida-server 运行，建议执行: adb shell setenforce 0"
      fi

      # Root 检查
      local has_root
      has_root=$($ADB shell su -c id 2>/dev/null | grep -c uid=0 || true)
      if [ "$has_root" -eq 0 ]; then
        warn "设备未 root - frida-server 需要 root 权限"
        errors=$((errors+1))
      else
        ok "设备已 root"
      fi

      # 架构检查
      local arch
      arch=$($ADB shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n')
      log "设备架构: $arch"
    fi
  fi

  # frida 版本匹配检查
  local frida_cli
  frida_cli=$(find_tool frida || true)
  if [ -n "$frida_cli" ]; then
    local cli_ver
    cli_ver=$("$frida_cli" --version 2>/dev/null | head -1)
    if [ -n "$ADB" ] && [ -n "$cli_ver" ]; then
      local srv_ver
      srv_ver=$($ADB shell frida-server --version 2>/dev/null | tr -d '\r\n')
      [ -z "$srv_ver" ] && srv_ver="not-found"
      if [ "$srv_ver" = "not-found" ]; then
        warn "frida-server 未在设备上运行（CLI 版本: $cli_ver）"
      elif [ "$srv_ver" != "$cli_ver" ]; then
        warn "frida 版本不匹配: CLI=$cli_ver Server=$srv_ver - 可能导致 hook 失败"
      else
        ok "frida 版本匹配: $cli_ver"
      fi
    fi
  fi

  # frida-dexdump 检查（仅 unpack 需要）
  if [ "${1:-}" = "--need-dexdump" ]; then
    local dexdump
    dexdump=$(find_tool frida-dexdump || true)
    if [ -z "$dexdump" ]; then
      warn "frida-dexdump 未找到 - 尝试 pip install frida-dexdump"
      pip3 install frida-dexdump 2>&1 | tail -1
      dexdump=$(find_tool frida-dexdump || true)
    fi

    if [ -z "$dexdump" ]; then
      warn "frida-dexdump 安装失败"
      errors=$((errors+1))
    else
      ok "frida-dexdump: $dexdump"
    fi
  fi

  return "$errors"
}

# ============================================================
# Vendor profile 解析
# 从 config.json 读取 vendor 对应的关键字和脚本
# 用法: vendor_keywords <vendor> <field>  (field: class_keywords|string_keywords)
#       vendor_scripts <vendor>
# ============================================================
vendor_keywords() {
  local vendor="$1" field="$2"
  python3 - "$V3_CONFIG" "$vendor" "$field" << 'PYEOF'
import json, sys
cfg = json.load(open(sys.argv[1]))
vendor = sys.argv[2]
field = sys.argv[3]
vp = cfg.get('vendor_profiles', {}).get(vendor, {})
kw = vp.get(field, [])
print('|'.join(kw) if kw else '')
PYEOF
}

vendor_scripts() {
  local vendor="$1"
  python3 - "$V3_CONFIG" "$vendor" << 'PYEOF'
import json, sys
cfg = json.load(open(sys.argv[1]))
vendor = sys.argv[2]
vp = cfg.get('vendor_profiles', {}).get(vendor, {})
scripts = vp.get('frida_scripts', [])
# _common.js 和 00_bootstrap.js 始终第一个加载
base = ['lib/_common.js', '00_bootstrap.js']
for s in scripts:
    if s not in ('_common.js', '00_bootstrap.js', 'lib/_common.js'):
        base.append(s)
for s in base:
    print(s)
PYEOF
}
