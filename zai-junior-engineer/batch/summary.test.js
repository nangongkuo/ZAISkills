// acs-junior-engineer/batch/summary.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { toCsv, toMarkdown } = require('./summary');

const ROWS = [
  { case_id: 'F001', title: '新增 banner', ability: 'feature', status: 'completed',
    wall_clock_sec: 600, final_stage: 8, compile_passed: true, compile_attempts: 1,
    spec_review: 'pass', test_result: 'pass', code_review: 'approved',
    commit_sha: 'abc', pr_url: 'https://pr/1', exit_code: 0, error_summary: '' },
  { case_id: 'B001', title: '修复,白屏', ability: 'bugfix', status: 'TIMEOUT',
    wall_clock_sec: 5400, final_stage: 3, compile_passed: false, compile_attempts: 3,
    spec_review: '', test_result: '', code_review: '',
    commit_sha: '', pr_url: '', exit_code: 124, error_summary: 'BLOCKED 编译失败' },
];

test('toCsv 含表头与两行，逗号字段被引号包裹', () => {
  const csv = toCsv(ROWS);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^case_id,title,ability,status,wall_clock_sec/);
  assert.match(lines[2], /"修复,白屏"/); // 含逗号需引号
});

test('toMarkdown 含 KPI 行与表格', () => {
  const md = toMarkdown(ROWS, { run_id: 'demo' });
  assert.match(md, /总 2/);
  assert.match(md, /completed 1/);
  assert.match(md, /\|F001\|/);
  assert.match(md, /Top/); // Top 失败原因段
});

