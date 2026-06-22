// acs-junior-engineer/batch/summary.js
'use strict';

const COLUMNS = [
  'case_id', 'title', 'ability', 'status', 'wall_clock_sec',
  'final_stage', 'compile_passed', 'compile_attempts',
  'spec_review', 'test_result', 'code_review',
  'commit_sha', 'pr_url', 'exit_code', 'error_summary',
];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const out = [COLUMNS.join(',')];
  for (const r of rows) {
    out.push(COLUMNS.map(c => csvCell(r[c])).join(','));
  }
  return out.join('\n') + '\n';
}

function mdCell(v) {
  if (v == null) return '';
  return String(v).replace(/\|/g, '\\|');
}

function toMarkdown(rows, meta) {
  const total = rows.length;
  const completed = rows.filter(r => r.status === 'completed').length;
  const others = total - completed;
  const avgMin = total
    ? (rows.reduce((s, r) => s + (Number(r.wall_clock_sec) || 0), 0) / total / 60).toFixed(1)
    : '0';

  const lines = [];
  lines.push(`# acs-junior-batch 汇总 - ${meta.run_id}`);
  lines.push('');
  lines.push(`总 ${total} / completed ${completed} / 其他 ${others} / 平均总耗时 ${avgMin} 分钟`);
  lines.push('');
  lines.push(`|${COLUMNS.join('|')}|`);
  lines.push(`|${COLUMNS.map(() => '-').join('|')}|`);
  for (const r of rows) {
    lines.push(`|${COLUMNS.map(c => mdCell(r[c])).join('|')}|`);
  }
  lines.push('');

  // Top 失败/BLOCKED 原因聚合
  const errCount = {};
  for (const r of rows) {
    const e = (r.error_summary || '').trim();
    if (!e) continue;
    errCount[e] = (errCount[e] || 0) + 1;
  }
  const top = Object.entries(errCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push('## Top 失败/BLOCKED 原因');
  lines.push('');
  if (top.length === 0) {
    lines.push('（无）');
  } else {
    for (const [e, n] of top) lines.push(`- (${n}) ${e}`);
  }
  lines.push('');
  return lines.join('\n');
}



module.exports = { toCsv, toMarkdown, COLUMNS };
