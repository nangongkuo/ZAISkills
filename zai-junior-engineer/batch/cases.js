// acs-junior-engineer/batch/cases.js
'use strict';

// 最小 YAML 解析：仅支持本工具 cases.yaml 的固定结构
// （顶层标量 run_name + defaults 扁平 kv + cases 对象数组）。
// 不通用，不替代 YAML 库，仅服务本场景。
function coerce(raw) {
  const s = String(raw ?? '').replace(/\s+#.*$/, '');
  const v = s.trim().replace(/^['"]|['"]$/g, '');
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseCasesYaml(text) {
  const lines = String(text).split('\n');
  const result = { run_name: null, defaults: {}, cases: [] };
  let section = null; // 'defaults' | 'cases' | null
  let current = null; // 正在构建的 case 对象

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // 顶层键（无缩进）
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (top && !line.startsWith(' ')) {
      const key = top[1].replace(/-/g, '_');
      const val = top[2];
      if (key === 'defaults') { section = 'defaults'; continue; }
      if (key === 'cases') { section = 'cases'; continue; }
      if (key === 'run_name') { result.run_name = coerce(val); section = null; continue; }
      section = null;
      continue;
    }

    if (section === 'defaults') {
      const m = line.match(/^\s*([\w-]+):\s*(.*)$/);
      if (m) result.defaults[m[1].replace(/-/g, '_')] = coerce(m[2]);
      continue;
    }

    if (section === 'cases') {
      // 新 case 起始：“- id: xx”或“- key: v”
      const dash = line.match(/^\s*-\s*([\w-]+):\s*(.*)$/);
      if (dash) {
        current = {};
        current[dash[1].replace(/-/g, '_')] = coerce(dash[2]);
        result.cases.push(current);
        continue;
      }

      // case 内续行字段
      const kv = line.match(/^\s+([\w-]+):\s*(.*)$/);
      if (kv && current) current[kv[1].replace(/-/g, '_')] = coerce(kv[2]);
    }
  }
  return result;
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

function validateCases(parsed) {
  const defaults = parsed.defaults || {};
  const seen = new Set();
  const out = [];

  for (const c of parsed.cases || []) {
    const merged = { ...defaults, ...c };

    if (!merged.id) throw new Error('case 少 id 字段');
    if (!ID_RE.test(String(merged.id))) throw new Error(`case id 非法（仅允许 [A-Za-z0-9_-]）：${merged.id}`);
    if (seen.has(merged.id)) throw new Error(`case id 重复（duplicate）：${merged.id}`);
    seen.add(merged.id);

    if (!merged.title) throw new Error(`case ${merged.id} 少 title`);
    if (!merged.repo) throw new Error(`case ${merged.id} 缺少 repo（defaults 或 case 需提供）`);

    const ability = merged.ability || 'feature';
    merged.ability = ability;
    merged.base_branch = merged.base_branch || 'master';
    merged.timeout_sec = merged.timeout_sec ?? 5400;
    if (typeof merged.timeout_sec !== 'number' || merged.timeout_sec <= 0) {
      throw new Error(`case ${merged.id} timeout_sec 必须是正数：${merged.timeout_sec}`);
    }

    if (ability === 'feature') {
      if (!merged.yuque_url) throw new Error(`case ${merged.id}（feature）缺少 yuque_url`);
    } else if (ability === 'bugfix') {
      const hasIdSource = merged.defect_id && merged.defect_source;
      const hasCtx = merged.defect_context;
      if (!hasIdSource && !hasCtx) {
        throw new Error(`case ${merged.id}（bugfix）需要 defect_id+defect_source 或 defect_context`);
      }
    } else {
      throw new Error(`case ${merged.id} ability 非法：${ability}（仅 feature/bugfix）`);
    }

    out.push(merged);
  }

  if (out.length === 0) throw new Error('cases.yaml 没有任何 case');
  return out;
}

module.exports = { parseCasesYaml, validateCases };
