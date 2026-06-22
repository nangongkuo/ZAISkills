#!/usr/bin/env node

/**
 * boot - 启动入口分流与菜单构造
 *
 * 用法: node lib/boot.js <repo_path>
 *
 * 输入: repo_path (仓库绝对路径)
 * 输出: JSON 决策包, phase 字段分流
 *
 * 两种 phase:
 *  - "new_task"    : state.md 不存在, 告知 LLM Read intent-router.md
 *  - "resume_menu" : state.md 存在, 构造三选项菜单 (continue / switch / exit)
 *
 * boot 内部调用 abilities.js 解析 task_type -> ability metadata; 不引入任何
 * 新业务规则, 是 tick + abilities + 菜单文案模板的门面层。
 */

const path = require('path');
const fs = require('fs');
const core = require('./junior-core');
const abilities = require('./abilities');

const { execFileSync } = require('child_process');

const WELCOME_TEXT = '👋 Alex (Lead): 欢迎进入 acs-junior-engineer 流水线。';

function ensureOpenSpec() {
  try {
    execFileSync('which', ['openspec'], { stdio: 'ignore' });
  } catch {
    process.stderr.write('⌛ openspec 未安装，正在安装...\n');
    try {
      execFileSync('npm', ['install', '-g', '@fission-ai/openspec'], { stdio: 'inherit' });
      process.stderr.write('✅ openspec 安装完成\n');
    } catch (e) {
      process.stderr.write(`⚠️ openspec 安装失败: ${e.message}\n`);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    process.stderr.write('Usage: node boot.js <repo_path>\n');
    process.exit(1);
  }
  return { repo_path: args[0] };
}

function buildNewTaskPayload(repoPath) {
  const intentRouterRel = 'stages/intent-router.md';
  return {
    phase: 'new_task',
    welcome_text: WELCOME_TEXT,
    next_action: {
      type: 'read_and_execute',
      file: intentRouterRel,
      file_abs: path.join(core.SKILL_BASE, intentRouterRel),
      description: '新任务流程: Read intent-router.md, inline 执行 (含意图识别 + ability init 派发)'
    }
  };
}

// stage N 的副作用检查通知规则: boot 描述「应该检查什么」，LLM 实际执行
// 规则集中在此处，新增 ability 或 stage 时改这里
function describeResumeChecks(currentStage, fm) {
  if (currentStage === 1) {
    // trans 模式: Echo 到 add-native-template, 产物是 git commit, 不写 enhanced-spec.md
    if (fm.task_type === 'trans') {
      return [{
        type: 'git_status',
        description: '检查 add-native-template 是否已完成 (commit 是否存在)',
        on_dirty: {
          action: 'ask_user',
          question: '工作树尚未提交变更（Echo 可能中途失败），如何处理？',
          options: [
            { id: 'redispatch', label: '重跑 Echo', description: '丢弃当前未提交变更，重新调用 add-native-template' },
            { id: 'continue', label: '继续（保留 diff）', description: '保留当前变更，调 tick 继续（如已完成会自动跳到 stage 2 触发 skip）' }
          ]
        },
        on_clean: {
          action: 'continue',
          hint: '工作树干净 + 代码已 commit (add-native-template 已完成)，调 tick 继续进入 skip 链路'
        }
      }];
    }
    // feature / bugfix 模式: 检查 enhanced-spec.md
    return [{
      type: 'file_exists',
      description: '检查 stage 1 agent 是否已产出 enhanced-spec.md',
      path_field: 'stage_1_enhanced_spec',
      path_value: fm.stage_1_enhanced_spec || null,
      on_missing: {
        action: 'redispatch_stage_1',
        hint: '文件不存在 → ability 路由的 agent 还没产出，调 tick 会重新走 dispatch 路径'
      },
      on_present: {
        action: 'continue',
        hint: '文件存在 → 视为已完成，调 tick 继续'
      }
    }];
  }
  if (currentStage === 3) {
    return [{
      type: 'git_status',
      description: '检查 git 工作树状态',
      on_dirty: {
        action: 'ask_user',
        question: '工作树有未提交变更，如何处理？',
        options: [
          { id: 'keep', label: '保留并继续', description: '保留当前 diff，由 James 继续' },
          { id: 'reset', label: '重置工作树后继续', description: '丢弃当前 diff，从干净状态继续' }
        ]
      },
      on_clean: { action: 'continue', hint: '直接调 tick 继续' }
    }];
  }
  if (currentStage === 4 || currentStage === 7) {
    return [{
      type: 'noop',
      description: `${currentStage === 4 ? 'Sean' : 'Vera'} 断点无副作用，直接调 tick 继续`
    }];
  }
  // 其他 stage (0 / 2 / 5 / 6 / 8): 默认无副作用
  return [{
    type: 'noop',
    description: 'stage 无副作用，直接调 tick 继续'
  }];
}

function buildResumeMenuPayload(repoPath, fm) {
  const taskType = fm.task_type;
  if (!taskType) {
    return {
      phase: 'error',
      welcome_text: WELCOME_TEXT,
      error: 'state.md 缺少 task_type 字段，无法路由 ability，建议执行 `acs-junior state <repo> reset` 后重新开始。'
    };
  }

  // ability metadata (display_name 用于菜单文案)
  let ability;
  try {
    ability = abilities.loadAbility(taskType);
  } catch (e) {
    return {
      phase: 'error',
      welcome_text: WELCOME_TEXT,
      error: `state.md.task_type="${taskType}" 但 abilities/${taskType}.md 不存在或非法: ${e.message}`
    };
  }

  // 角色 + 业务动作 (stage 1 按 ability 路由)
  const meta = core.getRoleLabel(fm.current_stage, fm);
  const stageStatus = fm[`stage_${fm.current_stage}_status`] || 'unknown';

  // 状态显示文案
  const statusDisplayMap = {
    pending: '待执行',
    in_progress: '执行中',
    done: '已完成',
    skipped: '已跳过',
    blocked: '受阻'
  };
  const statusDisplay = statusDisplayMap[stageStatus] || stageStatus;

  const continueLabel = meta
    ? `继续上次: ${ability.display_name} — ${meta.role} — ${meta.action}`
    : `继续上次: ${ability.display_name} — stage ${fm.current_stage}`;
  const continueDescription = meta
    ? `从 ${meta.role} ${meta.action} (${statusDisplay}) 继续`
    : `从 stage ${fm.current_stage} (${statusDisplay}) 继续`;

  const askUserQuestion = {
    question: '检测到未完成的流水线，下一步？',
    header: '上次进度',
    options: [
      { id: 'continue', label: continueLabel, description: continueDescription },
      { id: 'switch', label: '换一个意图', description: '丢弃当前 state.md（自动备份为 state.md.bak），重新选择意图开始新任务' },
      { id: 'exit', label: '退出', description: '本次不继续，state.md 保留供下次恢复' }
    ]
  };

  const handlers = {
    continue: {
      type: 'resume',
      resume_checks: describeResumeChecks(fm.current_stage, fm),
      after_check: {
        action: 'call_tick',
        command: `acs-junior tick ${repoPath}`,
        hint: '副作用检查通过后调 tick 进入流水执行循环'
      }
    },
    switch: {
      type: 'reset_then_route',
      commands: [
        {
          step: 1,
          type: 'shell',
          command: `acs-junior state ${repoPath} reset`,
          description: '删除当前 state.md（自动备份为 state.md.bak）'
        },
        {
          step: 2,
          type: 'read_and_execute',
          file: 'stages/intent-router.md',
          file_abs: path.join(core.SKILL_BASE, 'stages/intent-router.md'),
          description: 'Read intent-router.md, inline 执行新任务流程'
        }
      ]
    },
    exit: {
      type: 'stop',
      farewell_text: `已退出。state.md 保留在 ${path.join(repoPath, '.acs-junior-engineer/state.md')}，下次启动可继续。`
    }
  };

  return {
    phase: 'resume_menu',
    welcome_text: WELCOME_TEXT,
    context: {
      task_type: taskType,
      ability_display_name: ability.display_name,
      current_stage: fm.current_stage,
      current_role: meta ? meta.role : null,
      current_action: meta ? meta.action : null,
      stage_status: stageStatus,
      stage_status_display: statusDisplay
    },
    ask_user_question: askUserQuestion,
    handlers
  };
}

function main() {
  const { repo_path } = parseArgs();
  ensureOpenSpec();

  const statePath = core.getStatePath(repo_path);
  if (!fs.existsSync(statePath)) {
    process.stdout.write(JSON.stringify(buildNewTaskPayload(repo_path), null, 2) + '\n');
    return;
  }

  const fm = core.readStateFrontmatter(repo_path);
  if (!fm) {
    // state.md 存在但缺 frontmatter (legacy) → 当作 new_task 处理（提示用户重置）
    const payload = buildNewTaskPayload(repo_path);
    payload.warning = 'state.md 存在但缺 YAML frontmatter（旧版/损坏），建议先 `acs-junior state <repo> reset`';
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  // status === completed / failed 时，也走 resume_menu 让用户决定（继续看终态 / 换意图 / 退出）
  process.stdout.write(JSON.stringify(buildResumeMenuPayload(repo_path, fm), null, 2) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  buildNewTaskPayload,
  buildResumeMenuPayload,
  describeResumeChecks
};
