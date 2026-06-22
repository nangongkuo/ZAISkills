#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const core = require('./junior-core');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { repo_path: '', stage: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && i + 1 < args.length) {
      options.stage = parseInt(args[++i], 10);
    } else if (!args[i].startsWith('-')) {
      options.repo_path = args[i];
    }
  }

  return options;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const data = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const raw = trimmed.slice(colonIdx + 1).trim();

    if (raw === '' || raw === 'null') {
      data[key] = null;
    } else if (raw === 'true') {
      data[key] = true;
    } else if (raw === 'false') {
      data[key] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      data[key] = Number(raw);
    } else {
      data[key] = raw.replace(/^["']|["']$/g, '');
    }
  }

  return data;
}

// 显示名映射 = junior-core 业务字段（单一事实源）+ validate 专属字段。
// LLM 复述 validate 报告时优先使用 display_name，避免向用户泄漏 stage_N_xxx 原始字段名。
// 业务字段（系分/提案/编译/审查等）统一从 core.DISPLAY_NAMES 继承，改名只改 junior-core.js 一处。
// 本地只补 validate 报告专属的标签：①状态机字段（带「_状态」后缀，业务字典里不收）②校验伪字段（非真实 frontmatter key）。
const DISPLAY_NAMES = {
  ...core.DISPLAY_NAMES,
  // 顶层状态机字段（validate 报告专属）
  version: 'state.md 版本',
  current_stage: '当前阶段',
  status: '流程状态',
  // 校验伪字段（非 frontmatter key，仅 validate 内部检查项）
  state_file_exists: 'state.md 文件',
  frontmatter_exists: 'YAML frontmatter',
  // 阶段状态机字段（带「_状态」后缀，区别于业务字段）
  stage_0_status: 'Alex - 需求收集 状态',
  stage_1_status: 'Will - 系分增强 状态',
  stage_2_status: 'Alex - Spec 锁定 状态',
  stage_3_status: 'James - 编码实现 状态',
  stage_4_status: 'Sean - 规格校验 状态',
  stage_5_status: 'Tess - 自动测试 状态',
  stage_6_status: 'Alex - 代码提交 状态',
  stage_7_status: 'Vera - 质量审查 状态',
  stage_8_status: 'Alex - 提交发布 状态'
};

function getDisplayName(name) {
  if (DISPLAY_NAMES[name]) return DISPLAY_NAMES[name];
  // 兜底: stage_N_skip_reason 这类动态字段
  const skipMatch = name.match(/^stage_(\d+)_skip_reason$/);
  if (skipMatch) return '阶段跳过原因（内部）';
  return name;
}

function check(name, passed, detail) {
  return { name, display_name: getDisplayName(name), passed, detail: detail || null };
}

const BASIC_REQUIRED = ['repo_path', 'branch_name', 'base_branch'];

const STAGE_REQUIRED_OUTPUTS = {
  0: [],
  1: ['stage_1_doc_url', 'stage_1_doc_title', 'stage_1_enhanced_spec'],
  2: ['stage_2_proposal_id', 'stage_2_key_docs_proposal', 'stage_2_key_docs_spec',
      'stage_2_key_docs_design', 'stage_2_key_docs_tasks', 'stage_2_brainstorm'],
  3: ['stage_3_task_summary', 'stage_3_compile_passed', 'stage_3_changed_files'],
  4: ['stage_4_conclusion'],
  5: ['stage_5_conclusion', 'stage_5_report_path'],
  6: ['stage_6_commit_sha', 'stage_6_commit_message'],
  7: ['stage_7_conclusion', 'stage_7_report_path'],
  8: ['stage_8_push_status', 'stage_8_pr_url', 'stage_8_sprint_id', 'stage_8_build_result']
};

function validate(data, stageNum) {
  const checks = [];
  // P3 待办: task_type 硬编码（isBugfix / 下方 basicRequired 三元 / getStageRequired 的 bugfix 分支）
  // 应改造为读 abilities/<task_type>.md 的 required_state_fields，去除 if/else。
  // 暂留是因为 ability schema 还未声明 stage_N 的 required_outputs 字段一等加第 3 个 ability 验证 schema 完备性后统一改造。
  // 关联: stages/spec-confirm.md 的 9a/9b/10/11 task_type 分支同样在 P3 范围。
  const isBugfix = data.task_type === 'bugfix';

  // Version
  checks.push(check('version', data.version === '1.0.0',
    data.version === '1.0.0' ? null : `unexpected "${data.version}"`));

  // Current stage
  const cs = data.current_stage;
  checks.push(check('current_stage', typeof cs === 'number' && cs >= 0 && cs <= 8,
    typeof cs === 'number' ? null : `invalid: ${cs}`));

  // Status
  const validTop = ['running', 'completed', 'failed'];
  checks.push(check('status', validTop.includes(data.status),
    validTop.includes(data.status) ? null : `invalid: "${data.status}"`));

  // Task type
  const validTaskTypes = ['feature', 'bugfix', 'trans'];
  checks.push(check('task_type', validTaskTypes.includes(data.task_type),
    validTaskTypes.includes(data.task_type) ? null : `invalid: "${data.task_type}"`));

  // Basic info - task_type-dependent required fields
  let basicRequired;
  if (data.task_type === 'bugfix') {
    basicRequired = [...BASIC_REQUIRED, 'defect_context'];
  } else if (data.task_type === 'trans') {
    basicRequired = [...BASIC_REQUIRED, 'platform', 'cube_source', 'template_name'];
  } else {
    basicRequired = [...BASIC_REQUIRED, 'xuqiu_url'];
  }

  for (const field of basicRequired) {
    const val = data[field];
    const ok = typeof val === 'string' && val.length > 0;
    checks.push(check(field, ok, ok ? null : 'empty or missing'));
  }

  if (typeof data.autopilot !== 'boolean') {
    checks.push(check('autopilot', false, 'must be boolean'));
  }

  const validSp = ['installed', 'already_installed', 'failed', 'not_checked'];
  if (data.superpowers_status !== null && !validSp.includes(data.superpowers_status)) {
    checks.push(check('superpowers_status', false,
      `invalid "${data.superpowers_status}"`));
  }

  // Stage validation
  const validStatuses = ['pending', 'in_progress', 'done', 'skipped', 'blocked'];

  function getStageRequired(stage) {
    const base = STAGE_REQUIRED_OUTPUTS[stage] || [];
    if (stage === 1 && isBugfix) {
      // bugfix 模式: stage_1_doc_url 形如 rca://<path>，保留 required;
      // 额外要求 stage_1_complexity（透传自 Dave 产出的 enhanced-spec.md frontmatter, 供 Spec 锁定的 Brainstorm 条件判断）
      return [...base, 'stage_1_complexity'];
    }
    if (stage === 1 && data.task_type === 'trans') {
      // trans 模式: Echo 调 add-native-template 完成转码，不产出 doc_url / enhanced_spec / knowledge_index 等系分类字段
      return [];
    }
    return base;
  }

  if (stageNum !== null) {
    // Validate specific stage
    const statusKey = `stage_${stageNum}_status`;
    const st = data[statusKey];
    checks.push(check(statusKey, validStatuses.includes(st),
      validStatuses.includes(st) ? null : `invalid: "${st}"`));

    if (st === 'done') {
      const required = getStageRequired(stageNum);
      for (const field of required) {
        const val = data[field];
        const ok = val !== null && val !== undefined && val !== '';
        checks.push(check(field, ok, ok ? null : 'empty or missing'));
      }

      if (stageNum === 3) {
        checks.push(check('stage_3_compile_passed',
          data.stage_3_compile_passed === true,
          data.stage_3_compile_passed ? null : 'compile not passed'));
      }
    }

    if (st === 'skipped') {
      const reason = data[`stage_${stageNum}_skip_reason`];
      const ok = typeof reason === 'string' && reason.length > 0;
      checks.push(check(`stage_${stageNum}_skip_reason`, ok,
        ok ? null : 'skipped stage must have skip_reason'));
    }
  } else {
    // Validate all completed/skipped stages
    for (let i = 0; i <= 8; i++) {
      const st = data[`stage_${i}_status`];
      if (st === 'done' || st === 'skipped') {
        checks.push(check(`stage_${i}_status`, true));

        if (st === 'done') {
          const required = getStageRequired(i);
          for (const field of required) {
            const val = data[field];
            const ok = val !== null && val !== undefined && val !== '';
            checks.push(check(field, ok, ok ? null : 'empty or missing'));
          }
        }
      }
    }
  }

  return checks;
}

function main() {
  const options = parseArgs();

  if (!options.repo_path) {
    console.error('Usage: node validate-state.js <repo_path> [--stage N]');
    process.exit(1);
  }

  const statePath = path.join(options.repo_path, '.acs-junior-engineer', 'state.md');
  const allChecks = [];

  if (!fs.existsSync(statePath)) {
    allChecks.push(check('state_file_exists', false, `${statePath} not found`));
    output(allChecks);
    return;
  }
  allChecks.push(check('state_file_exists', true));

  const content = fs.readFileSync(statePath, 'utf-8');
  const data = parseFrontmatter(content);

  if (!data) {
    allChecks.push(check('frontmatter_exists', false, 'no YAML frontmatter found'));
    output(allChecks);
    return;
  }
  allChecks.push(check('frontmatter_exists', true));

  allChecks.push(...validate(data, options.stage));
  output(allChecks);
}

function output(checks) {
  const failed = checks.filter(c => !c.passed).length;
  const valid = failed === 0;

  console.log(JSON.stringify({
    valid,
    checks,
    summary: valid
      ? `ALL ${checks.length} checks passed`
      : `${failed} of ${checks.length} checks failed`
  }, null, 2));

  process.exit(valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { parseFrontmatter, validate };
