#!/bin/bash
#
# runtime_mods.sh - 运行时框架/动态修改检测（独立于“加固”）
# 用法：runtime_mods.sh <apk> > runtime_mods.json
#
# 这些都是合法的运行时 framework，**不是加固**，但会显著影响静态分析质量：
#   - InstantRun（阿里）              - 方法体被搬到 patch dex
#   - DexAOP（支付宝）                - 增强方法生成 invoker 类
#   - Tinker（微信） / Robust（美团） / Sophix（阿里） - 热修复
#   - DexClassLoader / PathClassLoader - 运行时加载额外 dex
#   - VMP 指标                        - 高熵 native so, QLLVM-like

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$SKILL_DIR/scripts/lib/_common.sh"

APK="${1:?用法：runtime_mods.sh <apk>}"
[ -f "$APK" ] || die "APK not found: $APK"

log "runtime_mods: $APK"

# 提取所有 dex 的 strings（一次性，避免反复 unzip）
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# unzip -p 多文件 glob 只输出第一个，解压所有 dex 再 strings 拼接
unzip -q "$APK" 'classes*.dex' -d "$TMP/dex" 2>/dev/null > /dev/null
for d in "$TMP/dex"/*.dex; do
  [ -f "$d" ] || continue
  strings "$d" 2>/dev/null
done > "$TMP/all_strings.txt" 2>/dev/null
SO_LIST=$(unzip -l "$APK" 2>/dev/null | awk '$NF ~ /^lib\// {print $NF}')

# 检测函数：grep -q 看是否命中（返回 yes/no + 第一行证据）
detect() {
  local pattern="$1"
  if grep -E "$pattern" "$TMP/all_strings.txt" -m 1 -q 2>/dev/null; then
    local sample
    sample=$(grep -E "$pattern" "$TMP/all_strings.txt" -m 1 2>/dev/null | head -1 | cut -c1-100)
    echo "true|$sample"
  else
    echo "false|"
  fi
}

INSTANT_RUN=$(detect 'com/android/alibaba/ip/runtime/IpChange')
DEXAOP=$(detect 'com/alipay/dexaop/Chain|com/alipay/dexaop/invokers/')
TINKER=$(detect 'com/tencent/tinker/loader|TinkerLoader|com/tencent/tinker/lib')
ROBUST=$(detect 'com/meituan/robust|com/meituan/robust/Patch')
SOPHIX=$(detect 'com/taobao/sophix|com/taobao/sophix/SophixManager|com/alipay/android/phone/sophix')
DEXCL=$(detect 'dalvik/system/DexClassLoader|Ldalvik/system/DexClassLoader')
PATHCL=$(detect 'dalvik/system/PathClassLoader|Ldalvik/system/PathClassLoader')

# VMP / QLLVM 启发：so 文件名或大小异常
VMP_INDICATORS=$(echo "$SO_LIST" | grep -iE 'sgmain|sgavmp|sgsec|fakejni|libpreverify|libmsaoaidsec|libbdd_secure|libtongdun|libcobub' | head -10)

# 综合评估：静态分析影响
IMPACT="low"
RECOMMENDS=()
if [[ "$INSTANT_RUN" == true* ]]; then
  IMPACT="high"
  RECOMMENDS+=("InstantRun: 业务类方法体可能被搬移；frida hook 在 ART 层仍有效，但 jadx 看到的代码不可信。优先用 waitForClass 等业务类延迟加载。")
fi
if [[ "$DEXAOP" == true* ]]; then
  [ "$IMPACT" = "low" ] && IMPACT="medium"
  RECOMMENDS+=("DexAOP: 大量 invoker 代理类污染搜索结果；hook 原始方法，不要 hook invoker。")
fi
if [[ "$TINKER" == true* ]] || [[ "$ROBUST" == true* ]] || [[ "$SOPHIX" == true* ]]; then
  [ "$IMPACT" = "low" ] && IMPACT="medium"
  RECOMMENDS+=("热修复框架: 线上版本可能与 APK 内代码不一致，分析结论需注明时效。")
fi
if [[ "$DEXCL" == true* ]] || [[ "$PATHCL" == true* ]]; then
  [ "$IMPACT" = "low" ] && IMPACT="medium"
  RECOMMENDS+=("动态加载 ClassLoader: 业务类可能从插件/远程拉取，静态 dex 不全。")
fi
if [ -n "$VMP_INDICATORS" ]; then
  [ "$IMPACT" = "low" ] && IMPACT="medium"
  RECOMMENDS+=("VMP/混淆 so 候选: $(echo "$VMP_INDICATORS" | tr '\n' ' ' | sed 's/ $//'). Native 算法不可逆向，仅定位入口。")
fi

# 序列化
parse_kv() {
  local v="$1"
  echo -n "{\"present\": $(echo "$v" | cut -d'|' -f1), \"evidence\": \"$(echo "$v" | cut -d'|' -f2- | sed 's/"/\\"/g' | head -c 100)\"}"
}

VMP_JSON=$(echo "$VMP_INDICATORS" | python3 -c "
import sys, json
items = [x.strip() for x in sys.stdin.read().split() if x.strip()]
print(json.dumps(items))
")

RECOMMENDS_JSON=$(printf '%s\n' "${RECOMMENDS[@]}" | python3 -c "
import sys, json
items = [x.rstrip() for x in sys.stdin if x.strip()]
print(json.dumps(items, ensure_ascii=False))
")

cat <<EOF
{
  "instant_run": $(parse_kv "$INSTANT_RUN"),
  "dexaop": $(parse_kv "$DEXAOP"),
  "tinker": $(parse_kv "$TINKER"),
  "robust": $(parse_kv "$ROBUST"),
  "sophix": $(parse_kv "$SOPHIX"),
  "dynamic_loader": {
    "DexClassLoader": $(echo "$DEXCL" | cut -d'|' -f1),
    "PathClassLoader": $(echo "$PATHCL" | cut -d'|' -f1)
  },
  "vmp_indicators": $VMP_JSON,
  "impact_on_static_analysis": "$IMPACT",
  "recommendations": $RECOMMENDS_JSON
}
EOF
