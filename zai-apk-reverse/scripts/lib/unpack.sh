#!/bin/bash
# unpack.sh - 加固自动脱壳处理器
# 用法: unpack.sh <apk> <workdir> <pkg> <packer_name>
#
# 策略:
#   full      -> frida-dexdump 直接 dump (90%+ 成功率)
#   partial   -> ClassLoader 遍历预热 + frida-dexdump + 可选冷启二刷
#   java_only -> frida-dexdump (Java 层可用, JNI 标记不可达)
#   vmp_only  -> 仅方法签名级 dump
#   manual    -> 输出详细手动指南
#
# 输出: workdir/unpack_result.json + workdir/unpacked_dex/

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$SKILL_DIR/scripts/lib/_common.sh"

APK="${1:?用法: unpack.sh <apk> <workdir> <pkg> <packer_name>}"
WORKDIR="${2:?用法: unpack.sh <apk> <workdir> <pkg> <packer_name>}"
PKG="${3:?用法: unpack.sh <apk> <workdir> <pkg> <packer_name>}"
PACKER="${4:?用法: unpack.sh <apk> <workdir> <pkg> <packer_name>}"

UNPACK_DIR="$WORKDIR/unpacked_dex"
mkdir -p "$UNPACK_DIR"

# ============================================================
# 1. 加固类型 -> 策略映射
# ============================================================
STRATEGY=$(packer_strategy "$PACKER")
if [ "$STRATEGY" = "unknown" ]; then
  STRATEGY="manual"
fi
log "加固检测: $PACKER -> 脱壳策略: $STRATEGY"

decision_log "$WORKDIR" "加固检测: packer=$PACKER -> strategy=$STRATEGY"

# ============================================================
# 2. manual 策略: 直接输出手动指南
# ============================================================
if [ "$STRATEGY" = "manual" ]; then
  cat >&2 <<EOF
================================================
⚠ 加固 $PACKER - 策略=manual, 需手动脱壳
================================================
当前脱壳策略不支持自动处理该加固类型。

方案 1: BlackDex (免 root)
  1. 下载: https://github.com/CodingGay/BlackDex
  2. adb install -r BlackDex.apk
  3. 打开 BlackDex -> 选择 $PKG -> 等待 -> 保存 dex
  4. dex 保存到: $UNPACK_DIR/
  5. 继续分析: bash $SKILL_DIR/scripts/lib/decompile.sh $WORKDIR $APK --unpacked-dex-dir $UNPACK_DIR

方案 2: FART (需刷机, 最完整)
  刷入 FART ROM -> 启动 $PKG -> 自动 dump 全量 DEX + 方法体

方案 3: 尝试 frida-dexdump (本脚本跳过)
  pip3 install frida-dexdump
  frida-dexdump -U -n $PKG -o $UNPACK_DIR

脱壳后继续:
  bash $SKILL_DIR/scripts/analyze.sh $APK --skip-decompile
  bash $SKILL_DIR/scripts/lib/decompile.sh $WORKDIR $APK --unpacked-dex-dir $UNPACK_DIR
  bash $SKILL_DIR/scripts/render.sh $WORKDIR
EOF

  echo "{ \"packer\": \"$PACKER\", \"strategy\": \"manual\", \"unpacked_dex_dir\": \"$UNPACK_DIR\", \"dex_count\": 0, \"note\": \"需手动脱壳\" }" \
    > "$WORKDIR/unpack_result.json"
  exit 0
fi

# ============================================================
# 3. 检查环境 (设备 + frida + frida-dexdump)
# ============================================================
log "===== 环境检查 ====="

# 检查 adb 设备
ADB=$(find_tool adb)
if [ -z "$ADB" ]; then
  warn "adb 未找到, 无法自动脱壳, 降级为 manual"
  STRATEGY="manual"
fi

if [ "$STRATEGY" != "manual" ]; then
  DEV_STATE=$($ADB get-state 2>/dev/null | tr -d '\r\n')
  if [ "$DEV_STATE" != "device" ]; then
    warn "adb 设备未连接 (state=${DEV_STATE:-none}), 降级为 manual"
    STRATEGY="manual"
  fi
fi

# 检查 frida
FRIDA=$(find_tool frida)
if [ -z "$FRIDA" ]; then
  warn "frida 未找到, 降级为 manual"
  STRATEGY="manual"
fi

# 检查 App 是否在运行
if [ "$STRATEGY" != "manual" ]; then
  APP_RUNNING=$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')
  if [ -z "$APP_RUNNING" ]; then
    log "App $PKG 未运行, 尝试启动..."
    # 尝试启动 App
    LAUNCH_ACT=$($ADB shell pm dump "$PKG" 2>/dev/null | grep -A1 'MAIN' | grep 'Activity' | head -1 | awk '{print $2}')
    if [ -n "$LAUNCH_ACT" ]; then
      $ADB shell am start -n "$PKG/$LAUNCH_ACT" &>/dev/null
    else
      $ADB shell monkey -p "$PKG" -c 'android.intent.category.LAUNCHER' 1 &>/dev/null
    fi
    log "等待 App 启动 (10s)..."
    sleep 10
    APP_RUNNING=$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')
  fi

  if [ -z "$APP_RUNNING" ]; then
    warn "App $PKG 无法启动, 降级为 manual"
    STRATEGY="manual"
  else
    ok "App $PKG 运行中 (pid=$APP_RUNNING)"
  fi
fi

# 检查 frida-dexdump
DEXDUMP=$(find_tool frida-dexdump)
if [ -z "$DEXDUMP" ] && [ "$STRATEGY" != "manual" ]; then
  warn "frida-dexdump 未找到, 尝试 pip install..."
  pip3 install frida-dexdump 2>&1 | tail -3
  DEXDUMP=$(find_tool frida-dexdump)
fi

if [ -z "$DEXDUMP" ] && [ "$STRATEGY" != "manual" ]; then
  warn "frida-dexdump 安装失败, 降级为 manual"
  STRATEGY="manual"
fi

# ============================================================
# 4. 执行自动脱壳
# ============================================================
if [ "$STRATEGY" = "manual" ]; then
  # 重新输出手动指南 (环境不满足)
  # (已经在步骤 2 输出过, 这里直接写结果文件)
  echo "{ \"packer\": \"$PACKER\", \"strategy\": \"manual\", \"unpacked_dex_dir\": \"$UNPACK_DIR\", \"dex_count\": 0, \"note\": \"环境不满足自动脱壳条件\" }" \
    > "$WORKDIR/unpack_result.json"
  exit 0
fi

log "===== 自动脱壳启动 (策略=$STRATEGY) ====="

# 4.1 抽取型加固: 先预热 ClassLoader
if [ "$STRATEGY" = "partial" ]; then
  log "抽取型加固, 执行 ClassLoader 预热..."
  PYTHON=$(find_tool python3)
  RUN_FRIDA="$SKILL_DIR/scripts/lib/run_frida.py"

  if [ -f "$RUN_FRIDA" ]; then
    WARMUP_LOG="$WORKDIR/evidence/logs/classloader-warmup.log"
    mkdir -p "$(dirname "$WARMUP_LOG")"

    "$PYTHON" "$RUN_FRIDA" --attach "$PKG" \
      "$SKILL_DIR/scripts/frida/lib/_common.js" \
      "$SKILL_DIR/scripts/frida/lib/_anti_detect.js" \
      "$SKILL_DIR/scripts/frida/lib/_force_load_classes.js" \
      --duration 30 --out "$WARMUP_LOG" 2>&1 | tail -5 || true

    WARMUP_CLASSES=$(grep -c 'loaded=' "$WARMUP_LOG" 2>/dev/null || echo 0)
    log "ClassLoader 预热完成 (约 $WARMUP_CLASSES 个业务类已加载)"
    decision_log "$WORKDIR" "ClassLoader 预热: $WARMUP_CLASSES 个业务类"
  else
    warn "run_frida.py 不可用, 跳过 ClassLoader 预热"
  fi
fi

# 4.2 非 VMP: frida-dexdump
DEX_COUNT=0
if [ "$STRATEGY" = "full" ] || [ "$STRATEGY" = "partial" ] || [ "$STRATEGY" = "java_only" ]; then
  log "执行 frida-dexdump -U -n $PKG -o $UNPACK_DIR ..."

  # 确保 App 还活着
  APP_RUNNING=$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')
  if [ -z "$APP_RUNNING" ]; then
    warn "App 已停止, 重新启动..."
    $ADB shell monkey -p "$PKG" -c 'android.intent.category.LAUNCHER' 1 &>/dev/null
    sleep 10
  fi

  "$DEXDUMP" -U -n "$PKG" -o "$UNPACK_DIR" 2>&1 | tee "$WORKDIR/unpack.log" | tail -10

  # 统计产出
  DEX_COUNT=$(find "$UNPACK_DIR" -name "*.dex" ! -path "*/r2/*" 2>/dev/null | wc -l | tr -d ' ')
  log "frida-dexdump 产出: $DEX_COUNT 个 dex"

  # 4.3 抽取型加固: 冷启二刷 (更多方法体)
  if [ "$STRATEGY" = "partial" ] && [ "$DEX_COUNT" -gt 0 ]; then
    log "抽取型加固, 冷启二刷脱壳..."
    $ADB shell am force-stop "$PKG" 2>/dev/null
    sleep 3
    $ADB shell monkey -p "$PKG" -c 'android.intent.category.LAUNCHER' 1 &>/dev/null
    sleep 15

    R2_DIR="$UNPACK_DIR/r2"
    mkdir -p "$R2_DIR"

    # 预热 + dump
    "$PYTHON" "$RUN_FRIDA" --attach "$PKG" \
      "$SKILL_DIR/scripts/frida/lib/_common.js" \
      "$SKILL_DIR/scripts/frida/lib/_anti_detect.js" \
      "$SKILL_DIR/scripts/frida/lib/_force_load_classes.js" \
      --duration 20 --out "$WORKDIR/evidence/logs/warmup-r2.log" 2>&1 | tail -3 || true

    "$DEXDUMP" -U -n "$PKG" -o "$R2_DIR" 2>&1 | tail -5
    R2_COUNT=$(find "$R2_DIR" -name "*.dex" 2>/dev/null | wc -l | tr -d ' ')
    log "二刷产出: $R2_COUNT 个新 dex"

    DEX_COUNT=$((DEX_COUNT + R2_COUNT))
  fi

  # 检查 frida-dexdump 是否真的有产出
  if [ "$DEX_COUNT" -eq 0 ]; then
    warn "frida-dexdump 产出 0 个 dex"
    # 检查是否因反 frida 失败
    if grep -qi "process.*not.*found\|failed.*attach\|crash" "$WORKDIR/unpack.log" 2>/dev/null; then
      warn "可能因反 frida 检测导致 App 崩溃, 尝试 spawn 模式 + anti_detect 注入"
      decision_log "$WORKDIR" "frida-dexdump attach 失败, 尝试 spawn 模式"

      $ADB shell am force-stop "$PKG" 2>/dev/null
      sleep 2

      # spawn 模式: 先注入 anti_detect 再 dump
      "$PYTHON" "$RUN_FRIDA" --spawn "$PKG" \
        "$SKILL_DIR/scripts/frida/lib/_common.js" \
        "$SKILL_DIR/scripts/frida/lib/_anti_detect.js" \
        "$SKILL_DIR/scripts/frida/00_bootstrap.js" \
        --duration 15 --out "$WORKDIR/evidence/logs/spawn-anti.log" 2>&1 | tail -3 || true

      "$DEXDUMP" -U -n "$PKG" -o "$UNPACK_DIR/spawn" 2>&1 | tail -5
      DEX_COUNT=$(find "$UNPACK_DIR" -name "*.dex" 2>/dev/null | wc -l | tr -d ' ')
    fi
  fi
fi

# 4.4 VMP only: 只能签名级 dump
if [ "$STRATEGY" = "vmp_only" ]; then
  log "VMP 加固: 尝试签名级 dump (方法体可能为 stub)..."
  "$DEXDUMP" -U -n "$PKG" -o "$UNPACK_DIR" 2>&1 | tail -5
  DEX_COUNT=$(find "$UNPACK_DIR" -name "*.dex" 2>/dev/null | wc -l | tr -d ' ')
fi

# ============================================================
# 5. 结果汇总
# ============================================================
if [ "$DEX_COUNT" -gt 0 ]; then
  ok "✅ 脱壳成功: $DEX_COUNT 个 dex"
  decision_log "$WORKDIR" "自动脱壳成功: packer=$PACKER strategy=$STRATEGY dex=$DEX_COUNT"

  # 设置 decompile 模式标记
  if [ "$STRATEGY" = "java_only" ]; then
    echo "java_only" > "$UNPACK_DIR/.unpack_note"
  elif [ "$STRATEGY" = "vmp_only" ]; then
    echo "vmp_only" > "$UNPACK_DIR/.unpack_note"
  fi
else
  warn "❌ 脱壳失败 (0 dex), 降级为 manual"
  STRATEGY="manual"
  decision_log "$WORKDIR" "自动脱壳失败: packer=$PACKER strategy=$STRATEGY"

  cat >&2 <<EOF
================================================
⚠ 自动脱壳失败 (0 dex)
================================================
已尝试: strategy=$STRATEGY

请手动脱壳:

方案 1: BlackDex (免 root)
  https://github.com/CodingGay/BlackDex
  adb install -r BlackDex.apk
  打开 -> 选择 $PKG -> 等待 -> 保存 dex 到 $UNPACK_DIR/

方案 2: FART (需刷机)
  刷入 FART ROM -> 启动 App -> 自动 dump

方案 3: 重试 (先检查 frida-server 版本匹配)
  frida --version && adb shell frida-server --version

脱壳后继续:
  bash $SKILL_DIR/scripts/lib/decompile.sh $WORKDIR $APK --unpacked-dex-dir $UNPACK_DIR
  bash $SKILL_DIR/scripts/render.sh $WORKDIR
EOF
fi

# 写结果
echo "{ \"packer\": \"$PACKER\", \"strategy\": \"$STRATEGY\", \"unpacked_dex_dir\": \"$UNPACK_DIR\", \"dex_count\": $DEX_COUNT }" \
  > "$WORKDIR/unpack_result.json"

log "脱壳完成: strategy=$STRATEGY dex=$DEX_COUNT dir=$UNPACK_DIR"
