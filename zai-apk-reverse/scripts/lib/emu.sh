#!/bin/bash
# emu_helper.sh - Android 模拟器/真机通用交互辅助
# 解决：屏幕息屏、坐标盲点、覆盖物拦截、frida-server 版本不一致 等高频痛点
#
# 用法：
#   source emu_helper.sh                 # 加载所有函数到当前 shell
#   emu_init                             # 自动找 adb，保持唤醒，设置 stay-on
#   emu_keep_awake                       # 永不息屏 + 充电态常亮
#   emu_tap_text "Agree"                 # 通过 UI Automator 文本找按钮再点（替代坐标盲点）
#   emu_back_to_app com.taobao.taobao    # 循环 BACK 直到 topResumedActivity 是目标包名
#   emu_dismiss_overlay                  # 检测拦截 Activity（登录/授权/弹窗）并 BACK
#   emu_state                            # 一次性输出 awake/locked/screen-on/topActivity 等
#   emu_screen <out.png>                 # 截屏到本地
#   emu_install_frida_server             # 推送匹配主机版本的 frida-server 并启动
#
# 注：全部函数依赖 EMU_ADB 全局变量，emu_init 会自动设置。

# ================================================================
# 工具发现（统一处理 ARM Mac dexdump 类问题）
# ================================================================
emu_find_tool() {
  local cmd="$1"

  # 1. PATH
  if command -v "$cmd" >/dev/null; then
    local p
    p=$(command -v "$cmd")
    # 架构匹配检查（避免 ARM Mac 跑 x86_64 二进制）
    if [[ "$OSTYPE" == "darwin"* ]] && file "$p" 2>/dev/null | grep -q "executable" && ! file "$p" 2>/dev/null | grep -qE "$(uname -m)|universal|script|shell"; then
      : # 架构不匹配，继续找
    else
      echo "$p"
      return 0
    fi
  fi

  # 2. Android SDK
  for p in "$HOME/Library/Android/sdk/platform-tools/$cmd" \
           "$HOME/Library/Android/sdk/build-tools/"*/"$cmd" \
           "$HOME/Android/sdk/platform-tools/$cmd" \
           "$HOME/Android/Sdk/platform-tools/$cmd" \
           "/opt/homebrew/share/android-sdk/platform-tools/$cmd"; do
    if [ -x "$p" ]; then
      # ARM Mac 上的 x86_64 二进制跳过
      if [[ "$OSTYPE" == "darwin"* && "$(uname -m)" == "arm64" ]] \
        && file "$p" 2>/dev/null | grep -q "x86_64" \
        && ! file "$p" 2>/dev/null | grep -qE "arm64|universal"; then
        continue
      fi
      echo "$p"
      return 0
    fi
  done

  # 3. Python user-base / npm-global / homebrew
  for p in "$HOME/Library/Python/3.9/bin/$cmd" \
           "$HOME/Library/Python/3.10/bin/$cmd" \
           "$HOME/Library/Python/3.11/bin/$cmd" \
           "$HOME/.local/bin/$cmd" \
           "$HOME/.npm-global/bin/$cmd" \
           "/opt/homebrew/bin/$cmd" \
           "/usr/local/bin/$cmd"; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done

  return 1
}

# ================================================================
# 初始化
# ================================================================
emu_init() {
  EMU_ADB=$(emu_find_tool adb)
  if [ -z "$EMU_ADB" ]; then
    echo "[emu] FATAL: adb 未找到" >&2
    return 1
  fi

  EMU_DEVICE=$($EMU_ADB devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')
  if [ -z "$EMU_DEVICE" ]; then
    echo "[emu] FATAL: 无设备连接" >&2
    return 1
  fi

  EMU_FRIDA=$(emu_find_tool frida)
  echo "[emu] adb=$EMU_ADB device=$EMU_DEVICE frida=${EMU_FRIDA:-(missing)}" >&2

  # 探测 screen size
  local sz
  sz=$($EMU_ADB shell wm size 2>/dev/null | awk '{print $NF}' | head -1)
  export EMU_SCREEN_W=${sz%x*}
  export EMU_SCREEN_H=${sz#*x}
  echo "[emu] screen=${EMU_SCREEN_W}x${EMU_SCREEN_H}" >&2

  export EMU_ADB EMU_DEVICE EMU_FRIDA
}

# ================================================================
# 屏幕/电源（修主要痛点：截图全黑 = 锁屏/休眠）
# ================================================================
emu_keep_awake() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  # stayon: 2=charging, true=all sources
  $EMU_ADB shell svc power stayon true 2>/dev/null
  # 30 min 屏幕超时
  $EMU_ADB shell settings put system screen_off_timeout 1800000 2>/dev/null
  # 如果还在锁屏，解锁
  if $EMU_ADB shell "dumpsys window 2>/dev/null | grep -q 'mShowingLockscreen=true'"; then
    $EMU_ADB shell input keyevent KEYCODE_MENU
    sleep 0.5
    $EMU_ADB shell input swipe ${EMU_SCREEN_W:-720} $(((${EMU_SCREEN_H:-2400}*4/5))) ${EMU_SCREEN_W:-720} $(((${EMU_SCREEN_H:-2400}*1/4))) 200
  fi
  echo "[emu] awake + stayon true + screen_off_timeout 30min" >&2
}

emu_state() {
  : ${EMU_ADB:?call emu_init first}
  echo "=== device state ==="
  echo "awake:     $($EMU_ADB shell dumpsys power 2>/dev/null | grep -E 'mWakefulness=' | head -1 | xargs)"
  echo "topAct:    $($EMU_ADB shell dumpsys activity activities 2>/dev/null | grep -E 'topResumedActivity' | head -1 | xargs)"
  echo "lockscreen: $($EMU_ADB shell dumpsys window 2>/dev/null | grep -E 'mShowingLockscreen' | head -1 | xargs)"
  echo "screen:    $($EMU_ADB shell dumpsys window 2>/dev/null | grep -E 'mAwake|mScreenOnEarly|mScreenOnFully' | head -1 | xargs)"
}

emu_screen() {
  : ${EMU_ADB:?call emu_init first}
  local out="${1:-/tmp/emu_screen_$(date +%s).png}"
  $EMU_ADB exec-out screencap -p > "$out"
  echo "$out"
}

# ================================================================
# Tap / 输入（替代盲点坐标）
# ================================================================
# 坐标 tap（兼容 EMU_SCREEN_W/H 计算百分比）
emu_tap() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell input tap "$1" "$2"
}

# 按百分比 tap（0-100），避免硬编码不同分辨率
emu_tap_pct() {
  : ${EMU_ADB:?call emu_init first}
  local x=$(( ${EMU_SCREEN_W:-1080} * $1 / 100 ))
  local y=$(( ${EMU_SCREEN_H:-2400} * $2 / 100 ))
  $EMU_ADB shell input tap $x $y
}

# 通过 UiAutomator dump 找文本对应控件并 tap（最稳）
# 用法：emu_tap_text "Agree" 或 emu_tap_text "立即登录"
emu_tap_text() {
  : ${EMU_ADB:?call emu_init first}
  local text="$1"
  local dump
  dump=$($EMU_ADB shell uiautomator dump --compressed /sdcard/uidump.xml 2>&1 && \
         $EMU_ADB exec-out cat /sdcard/uidump.xml)

  # 用 python 解析 XML 找匹配节点的 bounds
  local coord
  coord=$(echo "$dump" | python3 -c "
import sys, re
xml = sys.stdin.read()
target = '''$text'''
# 找所有 node 含目标文本（text 或 content-desc）
nodes = re.findall(r'<node[^>]*?(?:text=\"([^\"]*)\"|content-desc=\"([^\"]*)\")[^>]*?bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', xml)
for t, cd, x1, y1, x2, y2 in nodes:
    label = t or cd
    if target in label or target.lower() in label.lower():
        cx = (int(x1) + int(x2)) // 2
        cy = (int(y1) + int(y2)) // 2
        print(f'{cx} {cy}')
        sys.exit(0)
")
  if [ -z "$coord" ]; then
    echo "[emu_tap_text] '$text' not found in UI" >&2
    return 1
  fi
  echo "[emu_tap_text] '$text' -> $coord" >&2
  $EMU_ADB shell input tap $coord
}

emu_swipe_up() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell input swipe ${EMU_SCREEN_W:-720} $(((${EMU_SCREEN_H:-2400}*7/10))) ${EMU_SCREEN_W:-720} $(((${EMU_SCREEN_H:-2400}*2/10))) 400
}

emu_swipe_down() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell input swipe ${EMU_SCREEN_W:-720} $(((${EMU_SCREEN_H:-2400}*2/10))) ${EMU_SCREEN_W:-720} $(((${EMU_SCREEN_H:-2400}*7/10))) 400
}

# ================================================================
# 拦截页处理（登录/授权/系统弹窗自动 BACK）
# ================================================================
emu_top_activity() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell dumpsys activity activities 2>/dev/null \
    | grep -E 'topResumedActivity' \
    | head -1 \
    | grep -oE '[a-zA-Z][a-zA-Z0-9_.]+/[a-zA-Z0-9_.$]+' \
    | head -1
}

# 常见拦截/覆盖 Activity 关键字
EMU_INTERRUPT_KEYWORDS="login|signin|signup|UserLoginActivity|LoginUpgrade|AccountSetupActivity|GuideActivity|FaceLoginActivity|PermissionActivity|GuideActivity|UpgradeActivity|UpdateActivity|RemindActivity|PolicyActivity|PrivacyActivity"

# back 到目标包名（最多 N 次）
emu_back_to_app() {
  : ${EMU_ADB:?call emu_init first}
  local target="$1"
  local max="${2:-5}"
  for i in $(seq 1 "$max"); do
    local cur
    cur=$(emu_top_activity)
    if [[ "$cur" == *"$target"* ]]; then
      echo "[emu_back_to_app] OK @ $cur" >&2
      return 0
    fi
    echo "[emu_back_to_app] #$i cur=$cur, BACK" >&2
    $EMU_ADB shell input keyevent KEYCODE_BACK
    sleep 1
  done
  echo "[emu_back_to_app] FAIL: top=$(emu_top_activity), target=$target" >&2
  return 1
}

# 检测并 dismiss 拦截覆盖物（登录/授权/升级）
emu_dismiss_overlay() {
  : ${EMU_ADB:?call emu_init first}
  local max="${1:-3}"
  for i in $(seq 1 "$max"); do
    local cur
    cur=$(emu_top_activity)
    if echo "$cur" | grep -qiE "$EMU_INTERRUPT_KEYWORDS"; then
      echo "[emu_dismiss_overlay] #$i 检测到拦截: $cur, BACK" >&2
      $EMU_ADB shell input keyevent KEYCODE_BACK
      sleep 1
    else
      echo "[emu_dismiss_overlay] OK @ $cur" >&2
      return 0
    fi
  done
  return 1
}

# 启动 App
emu_launch_app() {
  : ${EMU_ADB:?call emu_init first}
  local pkg="$1"
  $EMU_ADB shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 2
}

emu_kill_app() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell am force-stop "$1"
}

# ================================================================
# Frida-server 管理（版本必须严格匹配主机 frida）
# ================================================================
emu_install_frida_server() {
  : ${EMU_ADB:?call emu_init first}
  if [ -z "$EMU_FRIDA" ]; then
    echo "[emu] FATAL: 主机未装 frida (pip3 install frida-tools)" >&2
    return 1
  fi

  local ver
  local arch
  ver=$($EMU_FRIDA --version 2>&1 | tr -d '\r\n ')
  arch=$($EMU_ADB shell getprop ro.product.cpu.abi | tr -d '\r\n ')
  echo "[emu] host frida=$ver, device arch=$arch" >&2

  # 找本地已下的 frida-server 二进制
  local candidates=(
    "$HOME/Downloads/frida-server-${ver}-android-${arch}"
    "$HOME/Downloads/frida-server-${ver}-android-${arch}.xz"
    "/tmp/frida-server-${ver}-android-${arch}"
    "/tmp/frida-server-android-${arch}"
  )

  local src=""
  for c in "${candidates[@]}"; do
    if [ -f "$c" ]; then
      src="$c"
      break
    fi
  done

  if [ -z "$src" ]; then
    local url="https://github.com/frida/frida/releases/download/${ver}/frida-server-${ver}-android-${arch}.xz"
    echo "[emu] 未在本地找到 frida-server-$ver-android-$arch" >&2
    echo "[emu] 下载: curl -L $url -o /tmp/fs.xz && xz -d /tmp/fs.xz && mv /tmp/fs /tmp/frida-server-${ver}-android-${arch}" >&2
    return 1
  fi

  if [[ "$src" == *.xz ]]; then
    xz -dk "$src"
    src="${src%.xz}"
  fi

  echo "[emu] push $src -> /data/local/tmp/frida-server" >&2
  $EMU_ADB push "$src" /data/local/tmp/frida-server >/dev/null
  $EMU_ADB shell chmod 755 /data/local/tmp/frida-server
  $EMU_ADB shell "pkill -9 frida-server 2>/dev/null"
  sleep 1
  $EMU_ADB shell "nohup /data/local/tmp/frida-server -l 127.0.0.1:27042 > /data/local/tmp/fs.log 2>&1 &"
  sleep 2
  if $EMU_ADB shell "ps -A 2>/dev/null | grep -q frida-server"; then
    echo "[emu] frida-server 已启动" >&2
    return 0
  fi
  echo "[emu] frida-server 启动失败，看 adb shell cat /data/local/tmp/fs.log" >&2
  return 1
}

emu_frida_running() {
  : ${EMU_ADB:?call emu_init first}
  $EMU_ADB shell "ps -A 2>/dev/null | grep -q frida-server" && return 0 || return 1
}

# ================================================================
# CLI 入口（也可 source 后直接调函数）
# ================================================================
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  cmd="${1:-state}"
  shift
  case "$cmd" in
    init)            emu_init ;;
    keep-awake)      emu_init >/dev/null; emu_keep_awake ;;
    state)           emu_init >/dev/null; emu_state ;;
    screen)          emu_init >/dev/null; emu_screen "$@" ;;
    tap)             emu_init >/dev/null; emu_tap "$@" ;;
    tap-text)        emu_init >/dev/null; emu_tap_text "$@" ;;
    back-to-app)     emu_init >/dev/null; emu_back_to_app "$@" ;;
    dismiss-overlay) emu_init >/dev/null; emu_dismiss_overlay "$@" ;;
    launch)          emu_init >/dev/null; emu_launch_app "$@" ;;
    kill)            emu_init >/dev/null; emu_kill_app "$@" ;;
    top)             emu_init >/dev/null; emu_top_activity ;;
    fs-install)      emu_init >/dev/null; emu_install_frida_server ;;
    fs-running)      emu_init >/dev/null; emu_frida_running && echo "yes" || echo "no" ;;
    *) cat <<EOF
emu_helper.sh - Android 设备/模拟器交互助手
用法：
  source emu_helper.sh && emu_init          # 加载所有函数
  ./emu_helper.sh state                     # 设备状态
  ./emu_helper.sh keep-awake                # 永不息屏
  ./emu_helper.sh screen out.png            # 截屏
  ./emu_helper.sh tap-text "Agree"          # 按文本 tap（替代坐标盲点）
  ./emu_helper.sh back-to-app com.taobao.taobao [maxRetry]
  ./emu_helper.sh dismiss-overlay [maxRetry]
  ./emu_helper.sh launch com.taobao.taobao
  ./emu_helper.sh kill com.taobao.taobao
  ./emu_helper.sh fs-install                # 推 frida-server 并启动
EOF
      ;;
  esac
fi
