#!/bin/bash
set -euo pipefail

# Usage: collect-diff.sh <repo_root> <base_ref> <head_ref>
#
# 收集并结构化输出 diff 信息，帮助 AI 快速进入分析阶段。
# 输出格式为带分隔符的文本，便于 AI 解析。

REPO_ROOT="$1"
BASE_REF="$2"
HEAD_REF="$3"
MAX_DIFF_LINES_PER_FILE=200

cd "$REPO_ROOT"

# 临时文件
TMP_ALL=$(mktemp)
TMP_CORE=$(mktemp)
TMP_TEST=$(mktemp)
TMP_CONFIG=$(mktemp)
TMP_RESOURCE=$(mktemp)
TMP_OTHER=$(mktemp)
trap "rm -f $TMP_ALL $TMP_CORE $TMP_TEST $TMP_CONFIG $TMP_RESOURCE $TMP_OTHER" EXIT

# ------------------------------------------------------------------------------
# 1. 基础统计
# ------------------------------------------------------------------------------
STAT=$(git diff "$BASE_REF".."$HEAD_REF" --stat | tail -1 || true)
FILE_LIST=$(git diff "$BASE_REF".."$HEAD_REF" --name-only || true)

echo "=== STATS ==="
if [[ -n "${STAT:-}" ]]; then
    echo "$STAT"
else
    echo "Files: 0"
fi

echo ""
echo "=== COMMITS ==="
git log "$BASE_REF".."$HEAD_REF" --pretty=format:"%h %s" --no-merges | head -50 || true

# ------------------------------------------------------------------------------
# 2. 过滤与分类文件
# ------------------------------------------------------------------------------
if [[ -z "${FILE_LIST:-}" ]]; then
    echo ""
    echo "=== CATEGORIES ==="
    echo "(no changes)"
    echo ""
    echo "=== RISK SIGNALS ==="
    echo "(no changes)"
    echo ""
    echo "=== CORE DIFFS ==="
    echo "(no changes)"
    exit 0
fi

echo "$FILE_LIST" > "$TMP_ALL"

# 排除规则
EXCLUDE_GLOB='\.(png|jpg|jpeg|gif|svg|ico|ttf|otf|woff|woff2)$'
EXCLUDE_DIR='/(build/|\.gradle/|\.idea/|Pods/|DerivedData/|\.xcworkspace/|Carthage/|oh_modules/|\.preview/|node_modules/|\.cache/|vendor/|\.git/|gradle/|.*\.build/)'
EXCLUDE_FILE='(R\.java|R\.txt|.*\.lock|.*\.generated\..*)'

grep -vE "$EXCLUDE_GLOB" "$TMP_ALL" | \
    grep -vE "$EXCLUDE_DIR" | \
    grep -vE "$EXCLUDE_FILE" > "$TMP_CORE" || true

# 从核心列表中拆分测试、配置、资源
if [[ -s "$TMP_CORE" ]]; then
    grep -iE '\.(test|spec|tests)\.|/(test|tests|androidTest|iosTest)/' "$TMP_CORE" > "$TMP_TEST" || true
    grep -v -f "$TMP_TEST" "$TMP_CORE" 2>/dev/null | \
        grep -iE '(build\.gradle|build\.gradle\.kts|settings\.gradle|podfile|package\.swift|package\.json|manifest|Info\.plist|module\.json5|build-profile\.json5|hvigorfile\.ts|proguard|\.properties|\.yaml|\.yml|\.json)$' > "$TMP_CONFIG" || true
    grep -v -f "$TMP_TEST" "$TMP_CORE" 2>/dev/null | \
        grep -v -f "$TMP_CONFIG" "$TMP_CORE" 2>/dev/null | \
        grep -iE '\.(xml|xib|storyboard|plist|json|strings|arb|lproj)/' > "$TMP_RESOURCE" || true
fi

# 其他 = 核心 - 测试 - 配置 - 资源
if [[ -s "$TMP_CORE" ]]; then
    cat "$TMP_CORE" | while read -r f; do
        if ! grep -Fxq "$f" "$TMP_TEST" 2>/dev/null && \
           ! grep -Fxq "$f" "$TMP_CONFIG" 2>/dev/null && \
           ! grep -Fxq "$f" "$TMP_RESOURCE" 2>/dev/null; then
            echo "$f" >> "$TMP_OTHER"
        fi
    done
fi

echo ""
echo "=== CATEGORIES ==="
for cat in test config resource other; do
    tmp_var="TMP_$(echo "$cat" | tr '[:lower:]' '[:upper:]')"
    tmp_path="${!tmp_var}"
    echo "[$cat]"
    if [[ -s "$tmp_path" ]]; then
        cat "$tmp_path"
    else
        echo "(none)"
    fi
done

# ------------------------------------------------------------------------------
# 3. 风险信号扫描（仅对 [other] 和 [config] 文件）
# ------------------------------------------------------------------------------
scan_signal() {
    local label="$1"
    local pattern="$2"
    local files="$3"
    if [[ ! -s "$files" ]]; then
        return
    fi
    local hits
    hits=$(git diff "$BASE_REF".."$HEAD_REF" -- $(cat "$files" | tr '\n' ' ') 2>/dev/null | \
        grep -nE "$pattern" | head -20 || true)
    if [[ -n "${hits:-}" ]]; then
        echo "[$label]"
        echo "$hits"
    fi
}

echo ""
echo "=== RISK SIGNALS ==="
HAS_SIGNAL=false

# 合并扫描文件
TMP_SCAN=$(mktemp)
trap "rm -f $TMP_SCAN" EXIT
if [[ -s "$TMP_OTHER" ]]; then cat "$TMP_OTHER" >> "$TMP_SCAN"; fi
if [[ -s "$TMP_CONFIG" ]]; then cat "$TMP_CONFIG" >> "$TMP_SCAN"; fi

if [[ -s "$TMP_SCAN" ]]; then
    out=$(scan_signal "A-rollback" "(Migration|ALTER TABLE|DROP TABLE|addMigrations|NSMigrationManager|lightweightMigration|@Table|@Column|relationalStore|rdbStore|DELETE FROM|TRUNCATE)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "B-concurrency" "(synchronized|@Synchronized|Lock|DispatchQueue|@Lock|mutex|async/await|launch\b|withAsync|Task\b|DispatchQueue\.async)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "B-null-safety" "(\!\!|NullPointerException|as!|ImplicitlyUnwrappedOptional|force unwrap)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "C-type-cast" "(as!|asInstanceOf|cast\b|unsafeCast)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "C-resource-leak" "(registerListener|addObserver|NotificationCenter\.addObserver|removeObserver|unregister)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "D-perf" "(onBindViewHolder|cellForRowAt|aboutToAppear|onDraw|static\s+(List|Map|Array|Mutable))" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "E-security" "(key\s*=|token\s*=|password\s*=|secret\s*=|SharedPreferences|UserDefaults|AppStorage|eval\b|runJavaScript)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi

    out=$(scan_signal "F-compat" "(Build\.VERSION|@RequiresApi|minSdkVersion|@available|#available|Deployment Target|API version)" "$TMP_SCAN")
    if [[ -n "${out:-}" ]]; then echo "$out"; HAS_SIGNAL=true; fi
fi

if [[ "$HAS_SIGNAL" == false ]]; then
    echo "(no strong signals)"
fi

# ------------------------------------------------------------------------------
# 4. 输出核心文件 diff (other + config)
# ------------------------------------------------------------------------------
echo ""
echo "=== CORE DIFFS ==="

TMP_DIFF_FILES=$(mktemp)
trap "rm -f $TMP_DIFF_FILES" EXIT
if [[ -s "$TMP_OTHER" ]]; then cat "$TMP_OTHER" >> "$TMP_DIFF_FILES"; fi
if [[ -s "$TMP_CONFIG" ]]; then cat "$TMP_CONFIG" >> "$TMP_DIFF_FILES"; fi

if [[ ! -s "$TMP_DIFF_FILES" ]]; then
    echo "(no core diffs)"
    exit 0
fi

TOTAL_DIFF_LINES=0

for f in $(cat "$TMP_DIFF_FILES"); do
    diff_lines=$(git diff "$BASE_REF".."$HEAD_REF" -- "$f" 2>/dev/null | wc -l | awk '{print $1}')
    TOTAL_DIFF_LINES=$((TOTAL_DIFF_LINES + diff_lines))
done

# 如果总 diff 行数超过 3000，对所有文件做截断显示
FORCE_TRUNCATE=false
if [[ "$TOTAL_DIFF_LINES" -gt 3000 ]]; then
    FORCE_TRUNCATE=true
fi

for f in $(cat "$TMP_DIFF_FILES"); do
    echo "--- $f ---"
    if [[ "$FORCE_TRUNCATE" == true ]]; then
        git diff "$BASE_REF".."$HEAD_REF" -- "$f" 2>/dev/null | head -n "$MAX_DIFF_LINES_PER_FILE" || true
        echo "... (truncated due to large total diff)"
    else
        git diff "$BASE_REF".."$HEAD_REF" -- "$f" 2>/dev/null || true
    fi
    echo ""
done
