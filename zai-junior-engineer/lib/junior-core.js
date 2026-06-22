const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKILL_BASE = path.dirname(__dirname);

const ROLE_LABELS = {
  0: { role: 'Alex (Lead)', action: '意图分流', short: 'Alex', estimated: '1-2 分钟' },
  1: { role: 'Will (Analyst)', action: '系分增强', short: 'Will', estimated: '3-5 分钟' },
  2: { role: 'Alex (Lead)', action: 'Spec 锁定', short: 'Alex', estimated: '5-10 分钟' },
  3: { role: 'James (Worker)', action: '编码实现', short: 'James', estimated: '5-15 分钟' },
  4: { role: 'Sean (Auditor)', action: '规格核验', short: 'Sean', estimated: '3-5 分钟' },
  5: { role: 'Tess (QA)', action: '自动测试', short: 'Tess', estimated: '5-10 分钟' },
  6: { role: 'Alex (Lead)', action: '代码提交', short: 'Alex', estimated: '<1 分钟' },
  7: { role: 'Vera (Gatekeeper)', action: '质量审查', short: 'Vera', estimated: '3-5 分钟' },
  8: { role: 'Alex (Lead)', action: '提交发布', short: 'Alex', estimated: '2-5 分钟' }
};

// 按 task_type 路由角色标签: stage 1 角色由 abilities/<task_type>.md 决定，其余沿用 ROLE_LABELS
// Lazy require 避免与 abilities.js 循环依赖
function getRoleLabel(stageNum, frontmatter) {
  if (stageNum === 1 && frontmatter && frontmatter.task_type) {
    const abilities = require('./abilities');
    return abilities.resolveRoleLabel(stageNum, frontmatter.task_type);
  }
  return ROLE_LABELS[stageNum];
}

const DISPLAY_NAMES = {
  repo_path: '仓库',
  branch_name: '分支',
  base_branch: '基准分支',
  yuque_url: '系分文档',
  test_yuque_url: '测试用例文档',
  dmore_url: '设计稿',
  autopilot: '无人驾驶模式',
  superpowers_status: 'Superpowers 状态',
  stage_1_doc_url: '系分文档',
  stage_1_doc_title: '系分文档标题',
  stage_1_doc_summary: '需求摘要',
  stage_1_enhanced_spec: '增强系分内容',
  stage_1_knowledge_index: '知识索引',
  stage_2_proposal_id: '提案 ID',
  stage_2_proposal_path: '提案路径',
  stage_2_core_change: '核心变更',
  stage_2_affected_files: '涉及文件',
  stage_2_key_docs_proposal: 'proposal 文档',
  stage_2_key_docs_spec: 'spec 文档',
  stage_2_key_docs_design: 'design 文档',
  stage_2_key_docs_tasks: 'tasks 文档',
  stage_2_brainstorm: 'Brainstorm 状态',
  stage_3_task_summary: '任务完成摘要',
  stage_3_compile_passed: '编译状态',
  stage_3_changed_files: '变更文件清单',
  stage_3_compile_status: '编译决策结果',
  stage_3_compile_attempts: '编译尝试次数',
  stage_4_conclusion: '规格核验结论',
  stage_5_conclusion: '自动测试结论',
  stage_5_failed: '测试失败用例数',
  stage_5_report_path: '测试报告',
  stage_6_commit_sha: 'Commit SHA',
  stage_6_commit_message: 'Commit Message',
  stage_7_conclusion: '质量审查结论',
  stage_7_report_path: '审查报告',
  stage_8_push_status: 'Push 状态',
  stage_8_pr_url: 'PR 链接',
  stage_8_sprint_id: '关联迭代',
  stage_8_build_result: '打包请求',
  stage_8_build_url: '构建链接',
  task_type: '任务类型',
  defect_context: '缺陷上下文',
  defect_id: '缺陷 ID',
  defect_source: '缺陷来源',
  defect_url: '缺陷链接',
  defect_keywords: '缺陷关键词',
  log_path: '日志路径',
  trigger_time: '触发时间',
  stage_1_complexity: '修复复杂度',
  platform: '目标平台',
  template_name: '模板名',
  template_id: '模板 ID',
  cube_source: 'Cube 源码'
};

// 各阶段派发文案中向用户展示的关键输入字段（按显示优先级）
// stage 1 由 abilities/<task_type>.md 的 dispatch_key_inputs 决定（见 buildDispatchInputsBlock）
const DISPATCH_KEY_INPUTS = {
  3: ['stage_2_proposal_id', 'stage_2_core_change'],
  4: ['branch_name', 'base_branch'],
  5: ['test_yuque_url'],
  7: ['stage_2_core_change', 'branch_name']
};

function getStatePath(repoPath) {
  return path.join(repoPath, '.acs-junior-engineer', 'state.md');
}

function readState(repoPath) {
  const p = getStatePath(repoPath);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

function splitFrontmatterAndBody(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  return { frontmatter: m[1], body: m[2] || '' };
}

function parseFrontmatter(content) {
  const parts = splitFrontmatterAndBody(content);
  if (!parts) return null;
  const data = {};
  for (const line of parts.frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const raw = trimmed.slice(colonIdx + 1).trim();
    if (raw === '' || raw === 'null') data[key] = null;
    else if (raw === 'true') data[key] = true;
    else if (raw === 'false') data[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) data[key] = Number(raw);
    else data[key] = raw.replace(/^["']|["']$/g, '');
  }
  return data;
}

function readStateFrontmatter(repoPath) {
  const content = readState(repoPath);
  if (!content) return null;
  return parseFrontmatter(content);
}

function parseAgentFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`agent file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };

  const fmText = m[1];
  const body = m[2];
  const fm = {};
  const lines = fmText.split('\n');
  let currentListKey = null;
  let listValues = [];

  const flushList = () => {
    if (currentListKey !== null) {
      fm[currentListKey] = listValues;
      currentListKey = null;
      listValues = [];
    }
  };

  for (const line of lines) {
    const listItemMatch = line.match(/^\s*-\s+(.+)$/);
    if (listItemMatch && currentListKey !== null) {
      listValues.push(listItemMatch[1].trim());
      continue;
    }
    flushList();

    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const raw = trimmed.slice(colonIdx + 1).trim();
    if (raw === '') {
      currentListKey = key;
      listValues = [];
    } else {
      fm[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  flushList();

  return { frontmatter: fm, body };
}

// 解析 pipeline-config.md 主表，返回 { 0: {stage, name, mode, file, conditional, next}, ... }
function parsePipelineConfig() {
  const filePath = path.join(SKILL_BASE, 'config', 'pipeline-config.md');
  const content = fs.readFileSync(filePath, 'utf-8');
  const stages = {};

  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 6) continue;
    const stageNum = cells[0];
    if (!/^\d+$/.test(stageNum)) continue;

    const fileCell = cells[3].replace(/^`|`$/g, '');
    const nextRaw = cells[5];
    const next = /^\d+$/.test(nextRaw) ? Number(nextRaw) : nextRaw;

    stages[Number(stageNum)] = {
      stage: Number(stageNum),
      name: cells[1],
      execution_mode: cells[2],
      skill_file: fileCell,
      conditional: cells[4] === 'true',
      next_stage: next
    };
  }
  return stages;
}

// 阶段条件检查（仅 stage 5 当前为条件执行）
function evaluateCondition(stageNum, frontmatter) {
  if (stageNum === 5) {
    const v = frontmatter.test_yuque_url;
    if (v === null || v === undefined || v === '') {
      return { met: false, skip_reason: '未提供测试用例文档URL' };
    }
    return { met: true };
  }
  return { met: true };
}

function getDispatchKeys(stageNum, frontmatter) {
  if (stageNum === 1 && frontmatter && frontmatter.task_type) {
    const abilities = require('./abilities');
    return abilities.resolveDispatchKeyInputs(frontmatter.task_type);
  }
  return DISPATCH_KEY_INPUTS[stageNum] || [];
}

function buildDispatchInputsBlock(stageNum, frontmatter) {
  const keys = getDispatchKeys(stageNum, frontmatter);
  const lines = [];
  for (const k of keys) {
    const v = frontmatter[k];
    if (v === null || v === undefined || v === '') continue;
    const display = DISPLAY_NAMES[k] || k;
    lines.push(`      ${display}: ${v}`);
  }
  return lines.join('\n');
}

function buildDispatchText(stageNum, frontmatter) {
  const meta = getRoleLabel(stageNum, frontmatter);
  const inputsBlock = buildDispatchInputsBlock(stageNum, frontmatter);
  const inputsSection = inputsBlock ? `\n   输入:\n${inputsBlock}` : '';
  return `📣 Alex (Lead): 正在发送消息给 ${meta.role}\n   任务: ${meta.short} - ${meta.action}${inputsSection}\n   ⏱️ 预计耗时: ${meta.estimated}，完成后自动通知您`;
}

function buildTaskIndicator(stageNum, frontmatter) {
  const meta = getRoleLabel(stageNum, frontmatter);
  const keys = getDispatchKeys(stageNum, frontmatter);
  const descParts = [];
  for (const k of keys) {
    const v = frontmatter[k];
    if (v === null || v === undefined || v === '') continue;
    const display = DISPLAY_NAMES[k] || k;
    descParts.push(`${display}: ${v}`);
    if (descParts.length >= 2) break;
  }
  const desc = descParts.length
    ? `${meta.short} - ${meta.action} (${descParts.join('，')})`
    : `${meta.short} - ${meta.action}`;
  return {
    subject: `${meta.short} - ${meta.action}`,
    active_form: `${meta.role} 正在${meta.action}...`,
    description: desc
  };
}

// ---------- frontmatter 写入辅助（advance / markStageInProgress 共用） ----------

function formatYamlValue(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw);
  if (s === '' || s === 'null') return '';
  if (s === 'true' || s === 'false') return s;
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (s.startsWith('"') && s.endsWith('"')) return s;
  if (s.includes('"') || s.includes(' ') || s.includes(':') || s.includes('#') || s.includes(',') || s.includes('[') || s.includes(']')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function findInsertPosition(lines, key) {
  const stageMatch = key.match(/^stage_(\d+)_/);
  if (stageMatch) {
    const stageNum = stageMatch[1];
    const prefix = `stage_${stageNum}_`;
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(prefix)) lastIdx = i;
    }
    if (lastIdx >= 0) return lastIdx + 1;
  }
  return lines.length;
}

// 在 frontmatter 中 set 多对 key=value，写回文件
function rewriteFrontmatter(repoPath, pairs) {
  const statePath = getStatePath(repoPath);
  if (!fs.existsSync(statePath)) {
    throw new Error(`state.md not found: ${statePath}`);
  }
  const content = fs.readFileSync(statePath, 'utf-8');
  const parts = splitFrontmatterAndBody(content);
  if (!parts) throw new Error('no YAML frontmatter found in state.md');

  const lines = parts.frontmatter.split('\n');
  for (const [key, rawValue] of pairs) {
    const formatted = formatYamlValue(rawValue);
    const newLine = formatted === '' ? `${key}:` : `${key}: ${formatted}`;
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const colonIdx = lines[i].indexOf(':');
      if (colonIdx === -1) continue;
      const lineKey = lines[i].slice(0, colonIdx).trim();
      if (lineKey === key) {
        lines[i] = newLine;
        found = true;
        break;
      }
    }
    if (!found) {
      const insertIdx = findInsertPosition(lines, key);
      lines.splice(insertIdx, 0, newLine);
    }
  }
  fs.writeFileSync(statePath, `---\n${lines.join('\n')}\n---\n${parts.body}`, 'utf-8');
}

function appendBody(repoPath, markdown) {
  const statePath = getStatePath(repoPath);
  const content = fs.readFileSync(statePath, 'utf-8');
  const sep = content.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(statePath, content + sep + markdown + '\n', 'utf-8');
}

function markStageInProgress(repoPath, stageNum) {
  rewriteFrontmatter(repoPath, [[`stage_${stageNum}_status`, 'in-progress']]);
}

// ---------- agent prompt 渲染（tick / render CLI 共用） ----------

function substituteVars(body, valueMap) {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (valueMap[name] === undefined || valueMap[name] === null) return '';
    return String(valueMap[name]);
  });
}

// 渲染 agent prompt: 从 pipeline-config + agent .md frontmatter 推 inputs，
// 从 state.md frontmatter 取值，替换 body 中的 {{var}}。
// 返回 { stage, stage_name, agent_file, agent_name, model, inputs_declared,
//        inputs_resolved, missing_inputs, prompt }。
// 错误: 抛 Error（unknown stage / non-agent stage / agent file missing / state unreadable）
function renderAgentPrompt(repoPath, stage) {
  const pipeline = parsePipelineConfig();
  const stageDef = pipeline[stage];
  if (!stageDef) {
    throw new Error(`stage ${stage} not found in pipeline-config`);
  }
  if (stageDef.execution_mode !== 'agent') {
    throw new Error(`stage ${stage} is ${stageDef.execution_mode}, render only supports agent stages`);
  }

  const stateFm = readStateFrontmatter(repoPath);
  if (!stateFm) {
    throw new Error(`state.md not readable at ${getStatePath(repoPath)}`);
  }

  // stage 1 按 task_type 路由：由 abilities/<task_type>.md 的 spec_enhance_agent 决定
  if (stage === 1 && stateFm.task_type) {
    const abilities = require('./abilities');
    stageDef.skill_file = abilities.resolveSpecEnhanceAgent(stateFm.task_type);
  }

  const agentPath = path.join(SKILL_BASE, stageDef.skill_file);
  const { frontmatter, body } = parseAgentFrontmatter(agentPath);
  const inputs = frontmatter.inputs || [];

  const resolved = {};
  const missing = [];
  for (const key of inputs) {
    const v = stateFm[key];
    if (v === null || v === undefined || v === '') {
      missing.push(key);
      resolved[key] = '';
    } else {
      resolved[key] = v;
    }
  }

  // 也支持 body 引用 inputs 之外的 frontmatter 字段（少见但稳健）
  const allBodyVars = new Set();
  for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) allBodyVars.add(m[1]);
  for (const v of allBodyVars) {
    if (!(v in resolved) && stateFm[v] !== undefined) {
      resolved[v] = stateFm[v] === null ? '' : stateFm[v];
    }
  }

  const prompt = substituteVars(body, resolved).trimStart();

  return {
    stage,
    stage_name: stageDef.name,
    agent_file: stageDef.skill_file,
    agent_name: frontmatter.name || null,
    model: frontmatter.model || null,
    inputs_declared: inputs,
    inputs_resolved: resolved,
    missing_inputs: missing,
    prompt
  };
}

// ---------- submit-iteration 辅助（platform 检测、module-id 4 层推断） ----------

function detectSubmitPlatform(repoPath) {
  const exists = (rel) => fs.existsSync(path.join(repoPath, rel));
  if (exists('hvigorfile.ts') || exists('build-profile.json5')) return 'Harmony';
  if (exists('build.gradle') || exists('build.gradle.kts') || exists('settings.gradle')) return 'Android';
  if (exists('Podfile') || exists('Package.swift')) return 'iOS';
  try {
    const entries = fs.readdirSync(repoPath);
    for (const e of entries) {
      if (e.endsWith('.podspec')) return 'iOS';
      if (e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace')) return 'iOS';
    }
  } catch (_) {}
  return null;
}

// 层 1: 读仓库内伙伴配置文件
function readModuleIdLayer1(repoPath) {
  const candidates = ['.huoban/module_id', '.acs/module_id'];
  for (const rel of candidates) {
    const p = path.join(repoPath, rel);
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf-8').trim();
      if (v) return { value: v, source: rel };
    }
  }
  // .huoban/config 内含 module_id 行
  const cfg = path.join(repoPath, '.huoban/config');
  if (fs.existsSync(cfg)) {
    const content = fs.readFileSync(cfg, 'utf-8');
    const m = content.match(/module[_-]?id\s*[:=]\s*['"]?([^\s'"]+)/i);
    if (m && m[1]) return { value: m[1], source: '.huoban/config' };
  }
  return null;
}

// 层 2a: 读构建文件提取 artifactId
function extractArtifactId(repoPath, platform) {
  try {
    if (platform === 'iOS') {
      const entries = fs.readdirSync(repoPath);
      const podspec = entries.find(e => e.endsWith('.podspec'));
      if (podspec) {
        const content = fs.readFileSync(path.join(repoPath, podspec), 'utf-8');
        const m = content.match(/(?:s|spec)\.name\s*=\s*['"]([^'"]+)['"]/);
        if (m) return { value: m[1], source: podspec };
      }
    } else if (platform === 'Android') {
      for (const f of ['build.gradle.kts', 'build.gradle']) {
        const p = path.join(repoPath, f);
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf-8');
          const m = content.match(/artifactId\s*[=]?\s*['"]([^'"]+)['"]/);
          if (m) return { value: m[1], source: f };
          const proj = content.match(/project\(['"]:([^'"]+)['"]\)/);
          if (proj) return { value: proj[1], source: f };
        }
      }
    } else if (platform === 'Harmony') {
      const p = path.join(repoPath, 'oh-package.json5');
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const m = content.match(/["']?name["']?\s*:\s*["']([^"']+)["']/);
        if (m) return { value: m[1], source: 'oh-package.json5' };
      }
    }
  } catch (_) {}
  return null;
}

// git remote 的 namespace 段（如 git@code.alipay.com:pipe/APMockData.git -> pipe）
function inferGitGroupName(repoPath) {
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd: repoPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const m = remote.match(/[:/]([^/]+)\/[^/]+(?:\.git)?$/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

// 层 2b: 从 git remote 推 groupId
function inferGroupId(repoPath, platform) {
  try {
    const product = inferGitGroupName(repoPath);
    if (platform === 'iOS') {
      return product ? `com.alipay.ios.phone.${product}` : 'com.alipay.ios';
    }
    if (platform === 'Android') {
      return product ? `com.alipay.android.phone.${product}` : 'com.alipay.android';
    }
    if (platform === 'Harmony') {
      return product ? `com.alipay.harmony.${product}` : 'com.alipay.harmony';
    }
  } catch (_) {}
  return null;
}

function getRepoName(repoPath) {
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd: repoPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const m = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch (_) {}
  return path.basename(repoPath);
}

// huoban-cli 包装: runHuoban(args, { timeout, allowFail })
function runHuoban(args, options = {}) {
  const timeout = options.timeout || 30000;
  try {
    const out = execSync(`huoban-cli ${args}`, {
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, stdout: out, stderr: '' };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : String(e.message),
      exitCode: e.status || 1
    };
  }
}



function isHuobanAvailable() {
  const r = runHuoban('user get', { timeout: 10000 });
  return { available: r.ok, reason: r.ok ? null : (r.stderr.split('\n')[0] || `exit ${r.exitCode}`) };
}

function runDima(args, options = {}) {
  const timeout = options.timeout || 30000;
  try {
    const out = execSync(`dima ${args}`, {
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, stdout: out, stderr: '' };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : String(e.message),
      exitCode: e.status || 1
    };
  }
}

function isDimaAvailable() {
  const r = runDima('auth me', { timeout: 10000 });
  return { available: r.ok, reason: r.ok ? null : (r.stderr.split('\n')[0] || `exit ${r.exitCode}`) };
}

// acs-trace 路径解析：优先取仓库内 bin/acs-trace，否则走 PATH
const ACS_TRACE_LOCAL = path.join(__dirname, '..', '..', 'bin', 'acs-trace');
const ACS_TRACE_CMD = fs.existsSync(ACS_TRACE_LOCAL) ? ACS_TRACE_LOCAL : 'acs-trace';

// 给当前活跃 trace 文件追加一行 stage 事件。
// 埋点失败永不阻塞主链路 -> 全部 swallow。
function emitTraceStage(stageName, phase) {
  if (!stageName || (phase !== 'start' && phase !== 'end')) return;
  try {
    require('child_process').spawnSync(ACS_TRACE_CMD, ['stage', stageName, phase], {
      stdio: 'ignore',
      timeout: 2000,
    });
  } catch {
    // ignore
  }
}

// 给当前活跃 trace 文件追加 intent 事件（span 顶层字段）。
function emitTraceIntent(taskType) {
  if (!taskType) return;
  try {
    require('child_process').spawnSync(ACS_TRACE_CMD, ['intent', taskType], {
      stdio: 'ignore',
      timeout: 2000,
    });
  } catch {
    // ignore
  }
}

// 给当前活跃 trace 文件追加 ended 事件，标记 skill 终态。
// 调用方应在 skill 终态出口（complete / fail）调用，确保 status 精确而非兜底 abandoned。
function emitTraceEnd(status, error) {
  if (status !== 'completed' && status !== 'failed') return;
  try {
    const args = ['end', '--status', status];
    if (error) args.push('--error', String(error).slice(0, 500));
    require('child_process').spawnSync(ACS_TRACE_CMD, args, {
      stdio: 'ignore',
      timeout: 2000,
    });
  } catch {
    // ignore
  }
}

// 给当前活跃 trace 文件追加 business 事件（非标量值，如数组 / 对象）。
// value 会被 JSON.stringify 后通过 --json 传给 acs-trace，落地为原生 JSON 类型。
// 失败永不阻塞主链路。
function emitTraceBusinessJSON(ability, key, value) {
  if (!ability || !key) return;
  try {
    require('child_process').spawnSync(
      ACS_TRACE_CMD,
      ['business', ability, key, '--json', JSON.stringify(value)],
      { stdio: 'ignore', timeout: 2000 }
    );
  } catch {
    // ignore
  }
}

// ---------- 看门狗（子 agent 派发超时兜底） ----------

// agent 阶段的超时分钟数（~ 预估上限 *2; stage 3 含编译，给足）。
// inline 阶段 (0/2/6/8) 不在表中 -> 不设看门狗。
const WATCHDOG_MINUTES = { 1: 18, 3: 28, 4: 10, 5: 18, 7: 10 };

function isWatchdogStage(stage) {
  return Object.prototype.hasOwnProperty.call(WATCHDOG_MINUTES, stage);
}

// 从 "10-20 分钟" / "3-5 分钟" / "<1 分钟" 提取最大分钟数
function parseMaxMinutes(durationStr) {
  if (!durationStr) return null;
  const nums = String(durationStr).match(/\d+/g);
  if (!nums) return null;
  return Math.max(...nums.map(Number));
}

// stage 1 的执行者由 ability 决定 (will/dave/echo 耗时差异大)，故 stage 1 的
// 看门狗窗口按 ability.estimated_duration 上界 *2 推导，并以固定表值为下限；
// 其余 stage (3/4/5/7) 用固定表。inline 阶段返回 null（不设看门狗）。
function getWatchdogMinutes(stage, fm) {
  if (!isWatchdogStage(stage)) return null;
  if (stage === 1 && fm && fm.task_type) {
    try {
      const abilities = require('./abilities');
      const ab = abilities.loadAbility(fm.task_type);
      const upper = parseMaxMinutes(ab.estimated_duration);
      if (upper) return Math.max(upper * 2, WATCHDOG_MINUTES[1]);
    } catch {
      // ability 解析失败 -> 返回固定表
    }
  }
  return WATCHDOG_MINUTES[stage] || null;
}

// 基于 Date.now()+minutes 生成 one-shot 5-field cron（本地时区，pin 到具体分钟）。
// 形如 "m h dom mon *"，喂给 CronCreate(recurring:false) 即一次性看门狗。
function buildWatchdogCron(minutes) {
  const fireAt = new Date(Date.now() + minutes * 60000);
  const m = fireAt.getMinutes();
  const h = fireAt.getHours();
  const dom = fireAt.getDate();
  const mon = fireAt.getMonth() + 1;
  return `${m} ${h} ${dom} ${mon} *`;
}

// 自包含 fire prompt：看门狗到点唤醒 Alex 时执行的内容（不依赖 REPL 历史）。
function buildWatchdogPrompt(stage, repoPath, meta) {
  const role = meta && meta.role ? meta.role : `stage ${stage}`;
  const action = meta && meta.action ? meta.action : '';
  return [
    `【看门狗-stage${stage}】acs-junior-engineer 流水线 stage ${stage} (${role} ${action}) 派发后可能超时。`,
    `请执行超时恢复检查（勿打扰用户，除非需升级）：`,
    `1. acs-junior watchdog-check ${repoPath} --stage ${stage}`,
    `2. 按 SKILL.md「看门狗超时恢复」处理：expired->静默结束；`,
    `   in_progress->TaskOutput 探测 stage_${stage}_task_id；completed 收尾 / running 续等 / 真死 重派或升级`
  ].join('\n');
}

module.exports = {
  SKILL_BASE,
  ROLE_LABELS,
  getRoleLabel,
  DISPLAY_NAMES,
  DISPATCH_KEY_INPUTS,
  getStatePath,
  readState,
  splitFrontmatterAndBody,
  parseFrontmatter,
  readStateFrontmatter,
  parseAgentFrontmatter,
  parsePipelineConfig,
  evaluateCondition,
  buildDispatchText,
  buildTaskIndicator,
  buildDispatchInputsBlock,
  markStageInProgress,
  formatYamlValue,
  rewriteFrontmatter,
  appendBody,
  renderAgentPrompt,
  detectSubmitPlatform,
  readModuleIdLayer1,
  extractArtifactId,
  inferGroupId,
  inferGitGroupName,
  getRepoName,
  runHuoban,
  isHuobanAvailable,
  runDima,
  isDimaAvailable,
  emitTraceStage,
  emitTraceIntent,
  emitTraceEnd,
  emitTraceBusinessJSON,
  WATCHDOG_MINUTES,
  isWatchdogStage,
  getWatchdogMinutes,
  buildWatchdogCron,
  buildWatchdogPrompt
};
