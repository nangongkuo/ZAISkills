#!/bin/bash
#
# render.sh - v3 入口 3: 聚合多轮 findings + 模板渲染 -> MASIQ 风格单文件 report.md
# 用法: render.sh <workdir>
#
# 行为:
#   1. 读 meta.json / runtime_mods.json / static_findings.json / findings/round-*.json
#   2. 把数据塞进 templates/report.md.tpl
#   3. 输出 ~/.apk-reverse/reports/<pkg>/report.md
#   4. 拷贝 evidence/ 到 reports 目录下，截图引用改相对路径
#
# 最后一行 stdout 是报告绝对路径

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export SKILL_DIR

if [ -f "$SKILL_DIR/scripts/lib/_common.sh" ]; then
  source "$SKILL_DIR/scripts/lib/_common.sh"
else
  SKILL_DIR="$SCRIPT_DIR"
  export SKILL_DIR
  source "$SCRIPT_DIR/_common.sh"
fi

WORKDIR="${1:?用法: render.sh <workdir>}"
[ -d "$WORKDIR" ] || die "workdir not found: $WORKDIR"
[ -f "$WORKDIR/meta.json" ] || die "缺 meta.json，先跑 analyze.sh"

PKG=$(json_get "$WORKDIR/meta.json" .package)
VER=$(json_get "$WORKDIR/meta.json" .version_name)
[ -z "$PKG" ] && die "pkg 解析失败"

REPORT_DIR="$REPORTS_ROOT/$PKG"
mkdir -p "$REPORT_DIR/evidence/"{screenshots,bodies,logs}

# 拷贝 evidence
if [ -d "$WORKDIR/evidence" ]; then
  if command -v rsync >/dev/null; then
    rsync -a "$WORKDIR/evidence/" "$REPORT_DIR/evidence/" 2>/dev/null
  else
    cp -R "$WORKDIR/evidence/"* "$REPORT_DIR/evidence/" 2>/dev/null
  fi
fi

# 拷贝 decision-log
[ -f "$WORKDIR/decision-log.md" ] && cp "$WORKDIR/decision-log.md" "$REPORT_DIR/decision-log.md"

# 拷贝 raw json（供 publish/调试）
cp "$WORKDIR/meta.json" "$REPORT_DIR/meta.json"
cp "$WORKDIR/runtime_mods.json" "$REPORT_DIR/runtime_mods.json" 2>/dev/null
cp "$WORKDIR/static_findings.json" "$REPORT_DIR/static_findings.json" 2>/dev/null

REPORT="$REPORT_DIR/report.md"
TPL="$SKILL_DIR/templates/report.md.tpl"
[ -f "$TPL" ] || die "模板不存在: $TPL"

log "render: pkg=$PKG ver=$VER -> $REPORT"

# 全部交给 python 渲染（避免 bash 字符串嵌套混乱）
PYTHON=$(find_tool python3)
"$PYTHON" - "$WORKDIR" "$REPORT_DIR" "$TPL" "$SKILL_DIR" << 'PYEOF'
import sys, os, json, re, glob, html, datetime, html as _html
from pathlib import Path

WORKDIR, REPORT_DIR, TPL_PATH, SKILL_DIR = sys.argv[1:5]

def load_json(p, default=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}

meta = load_json(os.path.join(WORKDIR, 'meta.json'))
rmods = load_json(os.path.join(WORKDIR, 'runtime_mods.json'))
static = load_json(os.path.join(WORKDIR, 'static_findings.json'))
task = ''
if os.path.exists(os.path.join(WORKDIR, '.task')):
    task = open(os.path.join(WORKDIR, '.task')).read().strip()

rounds = []
for fp in sorted(glob.glob(os.path.join(WORKDIR, 'findings', 'round-*.json'))):
    rounds.append(load_json(fp))

tpl = open(TPL_PATH).read()

# ============================================================
# 字段填充
# ============================================================
def human_size(n):
    n = int(n or 0)
    for u in ['B', 'KB', 'MB', 'GB']:
        if n < 1024:
            return f'{n:.1f} {u}'
        n /= 1024
    return f'{n:.1f} TB'

def md_escape(s):
    if s is None:
        return ''
    return str(s).replace('|', '\\|').replace('\n', ' ')

# Title
pkg = meta.get('package', '?')
ver = meta.get('version_name', '?')
nice_name = pkg.split('.')[-1].capitalize()
title = f'[APK 逆向] {nice_name} {ver}'

# 加固
packer = meta.get('packer', {})
packer_str = '无' if packer.get('name') == 'none' else f"**{packer.get('name')}**（证据：{packer.get('evidence')}）"

# 签名
sign = meta.get('signing', {})
sign_vecs = '/'.join([f'v{k}=✓' if sign.get(k) else '×' for k in ['1', '2', '3', '4'] if False])  # 不用这种
sv_parts = []
for k in ['v1', 'v2', 'v3', 'v4']:
    v = sign.get(k)
    sv_parts.append(f"{k}={'✓' if v else ('×' if v is False else '?')}")
sign_vers_str = ' / '.join(sv_parts)
sign_is_debug = '🔴 是（注意：可能是改包/重打包版本）' if sign.get('is_debug') else '否'

# Application 安全配置
app = meta.get('application', {})
def yn_risk(v, risky_when=False, hint_risky='', hint_safe='-'):
    if v == risky_when:
        return f'⚠ {hint_risky}' if hint_risky else '⚠ 风险'
    return hint_safe

allow_backup_hint = yn_risk(app.get('allow_backup'), True, '数据可被 adb backup 拉出', '安全')
cleartext_hint = yn_risk(app.get('uses_cleartext_traffic'), True, '允许 HTTP 明文', '安全')
debuggable_hint = yn_risk(app.get('debuggable'), True, '🔴 高危：debug 模式打包', '安全')

# 权限
perms = meta.get('permissions', [])
dangerous = [p for p in perms if p.get('level') == 'dangerous']
shown = dangerous[:] + [p for p in perms if p.get('level') == 'normal'][:max(0, 15-len(dangerous))]
perms_table = '| 权限 | 等级 |\n|---|---|\n'
for p in shown:
    icon = '⚠ dangerous' if p.get('level') == 'dangerous' else 'normal'
    perms_table += f"| `{p.get('name')}` | {icon} |\n"
perms_table += f'\n*总计 {len(perms)} 个权限，其中 dangerous {len(dangerous)} 个。*\n'

# 组件统计
comp_sum = meta.get('components_summary', {})
def _ex(comps):
    return sum(1 for c in comps if c.get('exported'))

comps = meta.get('components', {})
act_total = comp_sum.get('activities', 0)
svc_total = comp_sum.get('services', 0)
prv_total = comp_sum.get('providers', 0)
rcv_total = comp_sum.get('receivers', 0)
act_ex = _ex(comps.get('activities', []))
svc_ex = _ex(comps.get('services', []))
prv_ex = _ex(comps.get('providers', []))
rcv_ex = _ex(comps.get('receivers', []))

# Exported 列表
exported = []
for ctype in ['activities', 'services', 'providers', 'receivers']:
    for c in comps.get(ctype, []):
        if c.get('exported'):
            exported.append((ctype[:-1], c.get('name', '')))
exported_list = '\n'.join(f'- **{t}** `{n}`' for t, n in exported[:10])
if len(exported) > 10:
    exported_list += f'\n- *...及另外 {len(exported)-10} 个*'
if not exported_list:
    exported_list = '*无暴露组件*'

# DeepLinks
dl = meta.get('deeplinks', [])
seen_scheme = set()
dl_unique = []
for d in dl:
    k = (d.get('scheme'), d.get('host'))
    if k in seen_scheme:
        continue
    seen_scheme.add(k)
    dl_unique.append(d)
dl_table = '| scheme | host | 处理 Activity |\n|---|---|---|\n'
for d in dl_unique[:20]:
    dl_table += f"| `{d.get('scheme')}` | `{d.get('host', '')}` | `{(d.get('activity') or '')[:60]}` |\n"
dl_table += f'\n*共 {len(dl)} 条 deepLink，去重 scheme 后 {len(dl_unique)} 个。*\n'

# Libs
libs = meta.get('libs', [])
by_abi = {}
for l in libs:
    by_abi.setdefault(l.get('abi', ''), []).append(l)
libs_summary = ''
for abi, items in sorted(by_abi.items()):
    if not abi:
        continue
    total_size = sum(l.get('size', 0) for l in items)
    libs_summary += f'\n### {abi} - {len(items)} so，共 {human_size(total_size)}\n'
    for l in sorted(items, key=lambda x: -x.get('size', 0))[:10]:
        libs_summary += f"- `{os.path.basename(l['path'])}` ({human_size(l['size'])})\n"
    if len(items) > 10:
        libs_summary += f"- *...及另外 {len(items)-10} 个*\n"
if not libs_summary:
    libs_summary = '*无 native 库*'

# SDK hints
sdk = meta.get('sdk_hints', [])
sdk_list = '\n'.join(f'- `{s}`' for s in sdk[:30]) if sdk else '*未识别*'

# Assets
assets_sample = meta.get('assets_sample', [])
asset_names = ', '.join(f"`{a.get('path', '')}`" for a in assets_sample[:10])

# Runtime mods
rm_rows = []
for key, label in [
    ('instant_run', 'InstantRun（阿里热修复/方法搬移）'),
    ('dexaop', 'DexAOP（支付宝增强）'),
    ('tinker', 'Tinker（微信）'),
    ('robust', 'Robust（美团）'),
    ('sophix', 'Sophix（阿里）'),
]:
    info = rmods.get(key, {})
    present = '✓' if info.get('present') else '-'
    evid = info.get('evidence', '')[:80]
    rm_rows.append(f"| {label} | {present} | {evid} |")

dl_loaders = rmods.get('dynamic_loader', {})
rm_rows.append(f"| DexClassLoader | {'✓' if dl_loaders.get('DexClassLoader') else '-'} | - |")
rm_rows.append(f"| PathClassLoader | {'✓' if dl_loaders.get('PathClassLoader') else '-'} | - |")
vmp_ind = rmods.get('vmp_indicators', [])
rm_rows.append(f"| VMP 疑似 so | {'✓' if vmp_ind else '-'} | {len(vmp_ind)} 个: {', '.join(os.path.basename(p) for p in vmp_ind[:3])}{'...' if len(vmp_ind)>3 else ''} |")
runtime_mods_table = '| 框架 | 命中 | 证据 |\n|---|---|---|\n' + '\n'.join(rm_rows)

runtime_impact = rmods.get('impact_on_static_analysis', 'low')
runtime_recommendations = ''
recs = rmods.get('recommendations', [])
if recs:
    runtime_recommendations = '**建议**:\n\n' + '\n'.join(f'- {r}' for r in recs)

# Static findings
sf_rows = []
for k, v in static.items():
    if not isinstance(v, dict):
        continue
    count = v.get('count', 0)
    sample = v.get('sample', [])
    sample_str = '<br>'.join(f'`{md_escape(s)[:120]}`' for s in sample[:3])
    if len(sample) > 3:
        sample_str += f'<br><i>+{len(sample)-3} more</i>'
    sf_rows.append(f"| {k} | {count} | {sample_str or '-'} |")
static_findings_table = '| 类别 | 命中数 | 样本（前3） |\n|---|---|---|\n' + '\n'.join(sf_rows) if sf_rows else '*无静态 grep 数据*'

# Task template body
task_template_body = '*未选定 task，跳过任务特化分析*'
if task:
    task_md = os.path.join(SKILL_DIR, 'templates', 'tasks', f'{task}.md')
    if os.path.exists(task_md):
        task_template_body = open(task_md).read()
    else:
        task_template_body = f'*templates/tasks/{task}.md 不存在*'

# Dynamic rounds
if not rounds:
    dynamic_section = '*尚未做动态验证。要做请跑 `dynamic.sh <workdir> round-1`*'
else:
    parts = []
    for r in rounds:
        rid = r.get('round_id', '?')
        urls_count = len(r.get('urls', []))
        req_count = len(r.get('requests', []))
        resp_count = len(r.get('responses', []))
        top_act = r.get('top_activity_after', '?')
        # 折叠区
        body = f"<details><summary>Round {rid} - top={top_act} · {req_count} req / {resp_count} resp / {urls_count} url</summary>\n\n"
        # URLs
        if r.get('urls'):
            body += '**URLs**\n\n'
            for u in r['urls'][:10]:
                body += f'- `{u[:200]}`\n'
            if len(r['urls']) > 10:
                body += f'- *...+{len(r["urls"])-10}*\n'
        # Requests
        if r.get('requests'):
            body += '\n**API 请求**\n\n| # | api | v |\n|---|---|---|\n'
            for q in r['requests'][:20]:
                body += f"| {q['seq']} | `{q['api']}` | {q['version']} |\n"
            if len(r['requests']) > 20:
                body += f'\n*...+{len(r["requests"])-20}*\n'
        # Responses
        if r.get('responses'):
            body += '\n**响应**\n\n| # | api | size | body 文件 |\n|---|---|---|---|\n'
            for x in r['responses'][:20]:
                bp = x.get('body_path') or ''
                # 转相对路径
                if bp and REPORT_DIR in bp:
                    bp = os.path.relpath(bp, REPORT_DIR)
                elif bp:
                    bp = f"`{os.path.basename(bp)}`"
                body += f"| {x['seq']} | `{x['api']}` | {human_size(x['size'])} | {bp or '-'} |\n"
        # SO
        if r.get('so_loaded'):
            body += '\n**SO 加载热**: ' + ', '.join(f'`{s}`' for s in r['so_loaded'][:20]) + '\n'
        # 截图
        if r.get('screenshots'):
            body += '\n**截图**\n\n'
            for s in r['screenshots']:
                if REPORT_DIR in s:
                    rel = os.path.relpath(s, REPORT_DIR)
                else:
                    rel = os.path.basename(s)
                body += f'![round-{rid}-{os.path.basename(s)}]({rel})\n'
        body += '\n</details>\n'
        parts.append(body)
    dynamic_section = '\n'.join(parts)

# Key findings（人工待补，先给占位）
key_findings = '*由分析人员人工归纳，可参考 §1/§2/§3 的具体数据。建议结构：*\n\n' + \
'- 🔴/🟡/🟢 <一句话发现>【证据：§X.Y / round-N】<严重性：风险/信息>\n'

# Defense suggestions
defense_suggestions = '*由分析人员针对发现填写。常见建议：*\n' + \
'- 关闭 `debuggable` / `allowBackup`\n' + \
'- 配置 `network_security_config` 启用证书锁定\n' + \
'- 给 exported 组件加 `android:permission` 或调用方签名校验\n' + \
'- 移除硬编码密钥到 NDK\n'

# Decision log
dl_text = ''
dl_path = os.path.join(WORKDIR, 'decision-log.md')
if os.path.exists(dl_path):
    dl_text = open(dl_path).read()
else:
    dl_text = '*无决策日志*'

# Screenshots gallery
ss_md = ''
ss_dir = os.path.join(REPORT_DIR, 'evidence/screenshots')
if os.path.isdir(ss_dir):
    for f in sorted(os.listdir(ss_dir)):
        if f.endswith('.png'):
            ss_md += f'**{f}**\n\n![{f}](evidence/screenshots/{f})\n\n'
if not ss_md:
    ss_md = '*无截图*'

# Raw log previews
raw_md = ''
log_dir = os.path.join(REPORT_DIR, 'evidence/logs')
if os.path.isdir(log_dir):
    for f in sorted(os.listdir(log_dir)):
        fp = os.path.join(log_dir, f)
        if os.path.isfile(fp):
            try:
                content = open(fp).readlines()
            except Exception:
                continue
            raw_md += f'\n**{f}**（前 50 行 / {len(content)} 行总）\n\n```\n'
            raw_md += ''.join(content[:50])
            raw_md += '\n```\n'
if not raw_md:
    raw_md = '*无原始日志*'

# Frida task scripts placeholder
frida_task_scripts = ''
if task:
    cfg_path = os.path.join(SKILL_DIR, 'config.json')
    cfg = load_json(cfg_path)
    scripts = cfg.get('task_keywords', {}).get(task, {}).get('frida_scripts', [])
    paths = []
    for s in scripts:
        if s == '_common.js':
            continue # 已经在主命令里
        paths.append(f'{SKILL_DIR}/scripts/frida/{s}')
    frida_task_scripts = ' \\\n'.join(paths) if paths else f'{SKILL_DIR}/scripts/frida/trace_mtop.js'
else:
    frida_task_scripts = f'{SKILL_DIR}/scripts/frida/trace_mtop.js'

# class index info
ci = load_json(os.path.join(WORKDIR, 'class_index.json'), {})
total_classes = ci.get('total_classes', '?')
java_count = 0
dc = os.path.join(WORKDIR, 'decompiled')
if os.path.isdir(dc):
    for root, _, files in os.walk(dc):
        java_count += sum(1 for f in files if f.endswith('.java'))

# ============================================================
# 替换
# ============================================================
replacements = {
    'TITLE': title,
    'WORKDIR': WORKDIR,
    'TIMESTAMP': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'TLDR': '*请人工/Claude 补一句话核心结论*',
    'PACKAGE': pkg,
    'VERSION_NAME': ver,
    'VERSION_CODE': str(meta.get('version_code', '?')),
    'MIN_SDK': str(meta.get('min_sdk', '?')),
    'TARGET_SDK': str(meta.get('target_sdk', '?')),
    'COMPILE_SDK': str(meta.get('compile_sdk', '?')),
    'APK_SIZE_HUMAN': human_size(meta.get('apk_size', 0)),
    'SHA256': meta.get('sha256', ''),
    'DEX_COUNT': str(meta.get('dex_count', '?')),
    'APP_CLASS': app.get('name', '?'),
    'LAUNCH_ACT': meta.get('launch_activity', '?'),
    'PACKER': packer_str,
    'SIGN_VERSIONS': sign_vers_str,
    'SIGN_SUBJECT': sign.get('cert_subject', '?'),
    'SIGN_SHA256': sign.get('cert_sha256', '?'),
    'SIGN_IS_DEBUG': sign_is_debug,
    'ALLOW_BACKUP': str(app.get('allow_backup', '?')),
    'ALLOW_BACKUP_HINT': allow_backup_hint,
    'CLEARTEXT': str(app.get('uses_cleartext_traffic', '?')),
    'CLEARTEXT_HINT': cleartext_hint,
    'DEBUGGABLE': str(app.get('debuggable', '?')),
    'DEBUGGABLE_HINT': debuggable_hint,
    'NSC': app.get('network_security_config', '-'),
    'PERMISSIONS_TABLE': perms_table,
    'ACT_TOTAL': str(act_total), 'ACT_EXPORTED': str(act_ex),
    'SVC_TOTAL': str(svc_total), 'SVC_EXPORTED': str(svc_ex),
    'PRV_TOTAL': str(prv_total), 'PRV_EXPORTED': str(prv_ex),
    'RCV_TOTAL': str(rcv_total), 'RCV_EXPORTED': str(rcv_ex),
    'EXPORTED_LIST': exported_list,
    'DEEPLINKS_TABLE': dl_table,
    'LIBS_SUMMARY': libs_summary,
    'SDK_HINTS_LIST': sdk_list,
    'ASSETS_COUNT': str(meta.get('assets_count', 0)),
    'ASSETS_SAMPLE': asset_names,
    'RUNTIME_MODS_TABLE': runtime_mods_table,
    'RUNTIME_IMPACT': runtime_impact,
    'RUNTIME_RECOMMENDATIONS': runtime_recommendations or '*无特别建议*',
    'TOTAL_CLASSES': str(total_classes),
    'JAVA_COUNT': str(java_count),
    'TASK': task or '（未选定）',
    'STATIC_FINDINGS_TABLE': static_findings_table,
    'TASK_TEMPLATE_BODY': task_template_body,
    'DYNAMIC_ROUNDS': dynamic_section,
    'KEY_FINDINGS': key_findings,
    'SKILL_DIR': SKILL_DIR,
    'APK_PATH': meta.get('apk_path', ''),
    'FRIDA_TASK_SCRIPTS': frida_task_scripts,
    'DEFENSE_SUGGESTIONS': defense_suggestions,
    'DECISION_LOG': dl_text,
    'SCREENSHOTS': ss_md,
    'RAW_LOG_PREVIEWS': raw_md,
    'META_JSON_PRETTY': json.dumps(meta, ensure_ascii=False, indent=2),
    'RUNTIME_MODS_JSON_PRETTY': json.dumps(rmods, ensure_ascii=False, indent=2),
}

out = tpl
for k, v in replacements.items():
    out = out.replace('{{' + k + '}}', str(v))

report_path = os.path.join(REPORT_DIR, 'report.md')
open(report_path, 'w').write(out)
print(f'OK: {len(out)} chars -> {report_path}')
PYEOF

log "render 完成"
echo ""
echo "$REPORT"
