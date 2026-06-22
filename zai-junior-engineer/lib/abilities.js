#!/usr/bin/env node

/**
 * abilities - task_type 路由解析层
 *
 * 每个 abilities/<id>.md 描述一种 ability (task_type)。本模块解析 frontmatter
 * 并提供路由 API，供 tick / junior-core / intent-router / spec-confirm 使用。
 *
 * Schema 详见 abilities/_ability-schema.md.
 *
 * CLI 用法:
 *   node lib/abilities.js list [--json]
 *   node lib/abilities.js load <id> [--json]
 *   node lib/abilities.js resolve-init <task_type>
 *   node lib/abilities.js resolve-agent <task_type>
 *   node lib/abilities.js resolve-role <task_type>
 */

const fs = require('fs');
const path = require('path');
const core = require('./junior-core');

const ABILITIES_DIR = path.join(core.SKILL_BASE, 'abilities');

const REQUIRED_FIELDS = [
  'id',
  'display_name',
  'intent_description',
  'init_stage_file',
  'spec_enhance_agent',
  'role_label',
  'action_label',
  'estimated_duration'
];

const DEFAULTS = {
  dispatch_key_inputs: [],
  spec_confirm_mode: 'dual-confirm',
  spec_confirm_brainstorm_when: 'always',
  required_state_fields: [],
  optional_state_fields: [],
  skip_stages: []
};

// 读 abilities/<id>.md -> 解析 frontmatter -> 校验必填 -> 应用默认值
function loadAbility(id) {
  const filePath = path.join(ABILITIES_DIR, `${id}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`ability not found: ${id} (expected at ${filePath})`);
  }
  const { frontmatter } = core.parseAgentFrontmatter(filePath);

  for (const field of REQUIRED_FIELDS) {
    if (frontmatter[field] === undefined || frontmatter[field] === '') {
      throw new Error(`ability ${id}: missing required field "${field}"`);
    }
  }
  if (frontmatter.id !== id) {
    throw new Error(`ability ${id}: frontmatter.id="${frontmatter.id}" mismatches filename`);
  }

  const ability = { ...DEFAULTS, ...frontmatter };

  // skip_stages 在 frontmatter 中是字符串数组，需转 number 数组
  if (Array.isArray(ability.skip_stages)) {
    ability.skip_stages = ability.skip_stages
      .map(s => Number(s))
      .filter(n => Number.isInteger(n));
  }

  return ability;
}

// 扫描 abilities/*.md（过滤 _ 前缀），返回所有 ability 概要
// 用于 intent-router 渲染选项
function listAbilities() {
  if (!fs.existsSync(ABILITIES_DIR)) return [];
  const files = fs.readdirSync(ABILITIES_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => f.replace(/\.md$/, ''));
  return files.map(id => {
    const ab = loadAbility(id);
    return {
      id: ab.id,
      display_name: ab.display_name,
      intent_description: ab.intent_description
    };
  });
}

// 路由 API
function resolveInitStageFile(taskType) {
  return loadAbility(taskType).init_stage_file;
}

function resolveSpecEnhanceAgent(taskType) {
  return loadAbility(taskType).spec_enhance_agent;
}

// stage 1 在 ability 下的角色标签；其他 stage 沿用 junior-core.ROLE_LABELS
function resolveRoleLabel(stageNum, taskType) {
  if (stageNum === 1 && taskType) {
    const ab = loadAbility(taskType);
    const short = (ab.role_label.split(/\s+/)[0] || ab.role_label);
    return {
      role: ab.role_label,
      action: ab.action_label,
      short,
      estimated: ab.estimated_duration
    };
  }
  return core.ROLE_LABELS[stageNum];
}

function resolveDispatchKeyInputs(taskType) {
  return loadAbility(taskType).dispatch_key_inputs || [];
}

function resolveSpecConfirmStrategy(taskType) {
  const ab = loadAbility(taskType);
  return {
    mode: ab.spec_confirm_mode,
    brainstorm_when: ab.spec_confirm_brainstorm_when
  };
}

function resolveSkipStages(taskType) {
  return loadAbility(taskType).skip_stages || [];
}

// ---------- CLI ----------

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function printPlain(value) {
  process.stdout.write(String(value) + '\n');
}

function cliMain() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write('Usage: abilities.js <command> [args]\n');
    process.stderr.write('Commands: list | load <id> | resolve-init <task_type> | resolve-agent <task_type> | resolve-role <task_type>\n');
    process.exit(1);
  }

  const cmd = args[0];
  const wantJson = args.includes('--json');

  try {
    if (cmd === 'list') {
      const list = listAbilities();
      printJson(list);
      return;
    }

    if (cmd === 'load') {
      const id = args[1];
      if (!id) throw new Error('load requires <id>');
      printJson(loadAbility(id));
      return;
    }

    if (cmd === 'resolve-init') {
      const taskType = args[1];
      if (!taskType) throw new Error('resolve-init requires <task_type>');
      const out = resolveInitStageFile(taskType);
      wantJson ? printJson({ init_stage_file: out }) : printPlain(out);
      return;
    }

    if (cmd === 'resolve-agent') {
      const taskType = args[1];
      if (!taskType) throw new Error('resolve-agent requires <task_type>');
      const out = resolveSpecEnhanceAgent(taskType);
      wantJson ? printJson({ spec_enhance_agent: out }) : printPlain(out);
      return;
    }

    if (cmd === 'resolve-role') {
      const taskType = args[1];
      if (!taskType) throw new Error('resolve-role requires <task_type>');
      printJson(resolveRoleLabel(1, taskType));
      return;
    }

    throw new Error(`unknown command: ${cmd}`);
  } catch (e) {
    process.stderr.write(`abilities.js error: ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  cliMain();
}

module.exports = {
  ABILITIES_DIR,
  loadAbility,
  listAbilities,
  resolveInitStageFile,
  resolveSpecEnhanceAgent,
  resolveRoleLabel,
  resolveDispatchKeyInputs,
  resolveSpecConfirmStrategy,
  resolveSkipStages
};
