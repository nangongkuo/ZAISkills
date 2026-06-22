'use strict';
const fs = require('node:fs');
const { parseFrontmatter } = require('../lib/junior-core');

// 读单条 case 的 state.md，提取观测字段。缺失/解析失败 -> NO_STATE 兜底。
function readObservations(stateMdPath) {
  let content;
  try {
    content = fs.readFileSync(stateMdPath, 'utf-8');
  } catch {
    return { status: 'NO_STATE' };
  }
  const fm = parseFrontmatter(content);
  if (!fm) return { status: 'NO_STATE' };

  return {
    status: fm.status || 'NO_STATE',
    final_stage: fm.current_stage,
    task_type: fm.task_type,
    compile_passed: fm.stage_3_compile_passed,
    compile_attempts: fm.stage_3_compile_attempts != null ? fm.stage_3_compile_attempts : 1,
    spec_review: fm.stage_4_conclusion,
    test_result: fm.stage_5_conclusion,
    test_failed: fm.stage_5_failed,
    code_review: fm.stage_7_conclusion,
    cr_p0: fm.stage_7_p0,
    cr_p1: fm.stage_7_p1,
    commit_sha: fm.stage_6_commit_sha,
    pr_url: fm.stage_8_pr_url,
  };
}

module.exports = { readObservations };
