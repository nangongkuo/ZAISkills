// acs-junior-engineer/batch/state-builder.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildStateMd, buildDefectContext } = require('./state-builder');
const { parseFrontmatter } = require('../lib/junior-core');

const TS = '2026-06-02T10:00:00Z';

test('feature: 生成可被 parseFrontmatter 解析的 state.md', () => {
  const c = { id: 'F001', title: 't', repo: '/tmp/r', branch_name: 'feat/x',
    ability: 'feature', base_branch: 'master', yuque_url: 'https://y/abc' };
  const md = buildStateMd(c, TS);
  const fm = parseFrontmatter(md);
  assert.equal(fm.current_stage, 1);
  assert.equal(fm.task_type, 'feature');
  assert.equal(fm.autopilot, true);
  assert.equal(fm.status, 'running');
  assert.equal(fm.yuque_url, 'https://y/abc');
  assert.equal(fm.stage_0_status, 'done');
  assert.equal(fm.stage_1_status, 'pending');
  assert.equal(fm.stage_8_status, 'pending');
});

test('bugfix: task_type=bugfix 且写 defect 字段 + defect_context 路径', () => {
  const c = { id: 'B001', title: 't', repo: '/tmp/r', branch_name: 'fix/x',
    ability: 'bugfix', base_branch: 'master',
    defect_id: 'DIMA-1', defect_source: 'dima' };
  const md = buildStateMd(c, TS);
  const fm = parseFrontmatter(md);
  assert.equal(fm.task_type, 'bugfix');
  assert.equal(fm.defect_id, 'DIMA-1');
  assert.equal(fm.defect_source, 'dima');
  assert.equal(fm.defect_context, '.acs-junior-engineer/defect_context.md');
});

test('bugfix: 含 log_path / trigger_time 字段（模板对齐）', () => {
  const c = { id: 'B002', title: 't', repo: '/tmp/r', branch_name: 'fix/y',
    ability: 'bugfix', base_branch: 'master', defect_id: 'D-2', defect_source: 'dima',
    log_path: '/tmp/crash.log', trigger_time: '2026-06-02 10:00' };
  const md = buildStateMd(c, '2026-06-02T10:00:00Z');
  const fm = parseFrontmatter(md);
  assert.equal(fm.log_path, '/tmp/crash.log');
  assert.equal(fm.trigger_time, '2026-06-02 10:00');
});

test('bugfix: log_path / trigger_time 缺省为空', () => {
  const c = { id: 'B003', title: 't', repo: '/tmp/r', branch_name: 'fix/z',
    ability: 'bugfix', base_branch: 'master', defect_id: 'D-3', defect_source: 'dima' };
  const md = buildStateMd(c, '2026-06-02T10:00:00Z');
  const fm = parseFrontmatter(md);
  assert.equal(fm.log_path, null);                         // parseFrontmatter coerces empty to null
  assert.equal(fm.trigger_time, null);
});

test('buildDefectContext 用 defect_context 自由文本', () => {
  assert.match(buildDefectContext({ defect_context: '点击崩溃' }), /点击崩溃/);
});

test('buildDefectContext 无自由文本时用 defect_id 兜底', () => {
  assert.match(buildDefectContext({ defect_id: 'DIMA-1', defect_source: 'dima' }), /DIMA-1/);
});
