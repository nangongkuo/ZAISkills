// acs-junior-engineer/batch/cases.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCasesYaml, validateCases } = require('./cases');

const SAMPLE = `run_name: demo-run
defaults:
  repo: /tmp/repo
  base_branch: master
  model: claude-opus-4-0
  ability: feature
  timeout_sec: 5400
cases:
  - id: F001
    title: 新增 banner
    yuque_url: https://yuque/abc
  - id: B001
    title: 修复白屏
    ability: bugfix
    defect_id: DIMA-1
    defect_source: dima
`;

test('parseCasesYaml 解析 run_name/defaults/cases', () => {
  const r = parseCasesYaml(SAMPLE);
  assert.equal(r.run_name, 'demo-run');
  assert.equal(r.defaults.repo, '/tmp/repo');
  assert.equal(r.defaults.timeout_sec, 5400);
  assert.equal(r.cases.length, 2);
  assert.equal(r.cases[0].id, 'F001');
  assert.equal(r.cases[1].ability, 'bugfix');
});

test('validateCases 合并 defaults 并通过校验', () => {
  const r = parseCasesYaml(SAMPLE);
  const cases = validateCases(r);
  assert.equal(cases[0].repo, '/tmp/repo');
  assert.equal(cases[0].ability, 'feature');
  assert.equal(cases[0].model, 'claude-opus-4-0');
  assert.equal(cases[1].ability, 'bugfix');
});

test('feature 缺 yuque_url 报错', () => {
  const r = parseCasesYaml('defaults:\n  repo: /tmp/r\ncases:\n  - id: X\n    title: t\n');
  assert.throws(() => validateCases(r), /yuque_url/);
});

test('bugfix 缺 defect 信息报错', () => {
  const r = parseCasesYaml('defaults:\n  repo: /tmp/r\n  ability: bugfix\ncases:\n  - id: X\n    title: t\n');
  assert.throws(() => validateCases(r), /defect/);
});

test('id 重复报错', () => {
  const r = parseCasesYaml('defaults:\n  repo: /tmp/r\n  ability: feature\ncases:\n  - id: X\n    title: t\n    yuque_url: u\n  - id: X\n    title: t2\n    yuque_url: u2\n');
  assert.throws(() => validateCases(r), /重复|duplicate/i);
});

test('id 非法报错', () => {
  const r = parseCasesYaml('defaults:\n  repo: /tmp/r\n  ability: feature\ncases:\n  - id: 甲\n    title: t\n    yuque_url: u\n');
  assert.throws(() => validateCases(r), /id/);
});

test('timeout_sec=0 被拒绝（不再被静默改成默认）', () => {
  const r = parseCasesYaml('defaults:\n  repo: /tmp/r\n  ability: feature\ncases:\n  - id: X\n    title: t\n    yuque_url: u\n    timeout_sec: 0\n');
  assert.throws(() => validateCases(r), /timeout_sec/);
});

test('行内注释被剥离，但 URL 中的 # 保留', () => {
  const r = parseCasesYaml('defaults:\n  repo: /tmp/r\n  ability: feature\n  timeout_sec: 5400 # 单位秒\ncases:\n  - id: X\n    title: t\n    yuque_url: https://yuque/abc#frag\n');
  assert.equal(r.defaults.timeout_sec, 5400);
  const cases = validateCases(r);
  assert.equal(cases[0].yuque_url, 'https://yuque/abc#frag');
});
