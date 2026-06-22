// acs-junior-engineer/batch/state-reader.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readObservations } = require('./state-reader');

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-'));
  const f = path.join(dir, 'state.md');
  fs.writeFileSync(f, content);
  return f;
}

test('completed case 提取全字段', () => {
  const f = tmpFile(`---
status: completed
current_stage: 8
task_type: feature
stage_3_compile_passed: true
stage_3_compile_attempts: 2
stage_4_conclusion: pass
stage_5_conclusion: pass
stage_5_failed: 0
stage_7_conclusion: approved
stage_7_p0: 0
stage_7_p1: 1
stage_6_commit_sha: abc123
stage_8_pr_url: https://pr/1
---
body`);
  const o = readObservations(f);
  assert.equal(o.status, 'completed');
  assert.equal(o.final_stage, 8);
  assert.equal(o.compile_passed, true);
  assert.equal(o.compile_attempts, 2);
  assert.equal(o.spec_review, 'pass');
  assert.equal(o.test_result, 'pass');
  assert.equal(o.test_failed, 0);
  assert.equal(o.code_review, 'approved');
  assert.equal(o.cr_p0, 0);
  assert.equal(o.cr_p1, 1);
  assert.equal(o.commit_sha, 'abc123');
  assert.equal(o.pr_url, 'https://pr/1');
});

test('compile_attempts 缺失默认 1', () => {
  const f = tmpFile('---\nstatus: running\ncurrent_stage: 3\nstage_3_compile_passed: false\n---\n');
  const o = readObservations(f);
  assert.equal(o.compile_attempts, 1);
});

test('文件不存在返回 NO_STATE', () => {
  const o = readObservations('/nonexistent/path/state.md');
  assert.equal(o.status, 'NO_STATE');
});
