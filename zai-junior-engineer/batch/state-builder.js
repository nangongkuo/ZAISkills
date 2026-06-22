// acs-junior-engineer/batch/state-builder.js
'use strict';

// 生成 stage 0 完整 state.md（autopilot 续跑 stage 1）。
// 字段严格对齐 stages/feature-init.md Step7 与 stages/bugfix-init.md Step7。
function buildStateMd(c, startedAtIso) {
  const lines = [];
  lines.push('---');
  lines.push('version: "1.0.0"');
  lines.push('current_stage: 1');
  lines.push(`started_at: "${startedAtIso}"`);
  lines.push('status: running');
  lines.push(`task_type: ${c.ability}`);

  if (c.ability === 'bugfix') {
    lines.push('defect_context: .acs-junior-engineer/defect_context.md');
  }

  lines.push(`repo_path: ${c.repo}`);
  lines.push(`branch_name: ${c.branch_name}`);

  if (c.ability === 'feature') {
    lines.push(`yuque_url: ${c.yuque_url}`);
  } else {
    lines.push('yuque_url:');
  }

  lines.push(`test_yuque_url: ${c.test_yuque_url || ''}`);
  lines.push(`dmore_url: ${c.dmore_url || ''}`);
  lines.push(`base_branch: ${c.base_branch}`);
  lines.push('autopilot: true');
  lines.push('superpowers_status: not_checked');

  if (c.skip_build_check) {
    lines.push('skip_build_check: true');
  }

  if (c.ability === 'bugfix') {
    lines.push(`defect_id: ${c.defect_id || '未提供'}`);
    lines.push(`defect_source: ${c.defect_source || 'manual'}`);
    lines.push(`defect_url: ${c.defect_url || '未提供'}`);
    lines.push(`defect_keywords: ${c.defect_keywords || ''}`);
    lines.push(`log_path: ${c.log_path || ''}`);
    lines.push(`trigger_time: ${c.trigger_time || ''}`);
  }

  lines.push('stage_0_status: done');
  lines.push('stage_0_duration: 0');
  for (let n = 1; n <= 8; n++) lines.push(`stage_${n}_status: pending`);
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

// 缺陷上下文文件正文（bugfix 时写到 .acs-junior-engineer/defect_context.md）。
function buildDefectContext(c) {
  const body = c.defect_context
    ? String(c.defect_context)
    : `缺陷 ID：${c.defect_id || '未提供'}\n来源：${c.defect_source || 'manual'}`;
  return `# 缺陷描述\n\n${body}\n`;
}


module.exports = { buildStateMd, buildDefectContext };
