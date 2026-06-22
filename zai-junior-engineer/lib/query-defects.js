#!/usr/bin/env node

/**
 * query-defects - 缺陷查询 CLI 模块
 *
 * 用法:
 *   acs-junior defect probe
 *     — 探测 huoban-cli / dima 可用性
 *
 *   acs-junior defect query [--product wallet] [--page-size 20]
 *     — 双源并发查询，输出统一 JSON 列表
 *
 *   acs-junior defect get <id> --source huoban|dima
 *     — 拉取单个缺陷详情
 */

const core = require('./junior-core');

function parseArgs() {
  const args = process.argv.slice(2);
  const sub = args[0];
  const opts = {
    sub,
    id: '',
    source: '',
    product: 'wallet',
    page_size: 20
  };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--source') opts.source = args[++i];
    else if (a === '--product') opts.product = args[++i];
    else if (a === '--page-size') opts.page_size = parseInt(args[++i], 10) || 20;
    else if (!a.startsWith('-')) opts.id = a;
  }
  if (!sub || !['probe', 'query', 'get'].includes(sub)) {
    process.stderr.write('Usage:\n');
    process.stderr.write('  query-defects probe\n');
    process.stderr.write('  query-defects query [--product wallet] [--page-size 20]\n');
    process.stderr.write('  query-defects get <id> --source huoban|dima\n');
    process.exit(1);
  }
  return opts;
}

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

// ---------- probe ----------

function cmdProbe() {
  const huoban = core.isHuobanAvailable();
  const dima = isDimaAvailableWithStaff();
  emit({ huoban, dima });
}

function isDimaAvailableWithStaff() {
  const r = core.runDima('auth me', { timeout: 10000 });
  if (!r.ok) return { available: false, reason: r.stderr.split('\n')[0] || `exit ${r.exitCode}` };
  const staffMatch = r.stdout.match(/staff\s*ID\s*:\s*(\S+)/i);
  return { available: true, reason: null, staff_id: staffMatch ? staffMatch[1] : null };
}

// ---------- query ----------

function cmdQuery(opts) {
  const results = { sources: {}, defects: [], total: 0 };

  const huobanDefects = queryHuoban(opts.product, opts.page_size);
  results.sources.huoban = huobanDefects.status;
  if (huobanDefects.status === 'ok') {
    for (const d of huobanDefects.items) {
      results.defects.push({ ...d, source: 'huoban' });
    }
  }

  const dimaDefects = queryDima();
  results.sources.dima = dimaDefects.status;
  if (dimaDefects.status === 'ok') {
    for (const d of dimaDefects.items) {
      results.defects.push({ ...d, source: 'dima' });
    }
  }

  results.defects.forEach((d, i) => { d.index = i + 1; });
  results.total = results.defects.length;
  emit(results);
}

function queryHuoban(product, pageSize) {
  if (!core.isHuobanAvailable().available) {
    return { status: 'failed', error: 'huoban-cli not available', items: [] };
  }

  // Step 1: get release list to find main integration version
  const releaseResult = core.runHuoban(
    `release list --product-name=${product} --page-size=50`,
    { timeout: 30000 }
  );
  if (!releaseResult.ok) {
    return { status: 'failed', error: releaseResult.stderr.split('\n')[0], items: [] };
  }

  let releases;
  try {
    releases = JSON.parse(releaseResult.stdout);
  } catch (_) {
    return { status: 'failed', error: 'failed to parse release list JSON', items: [] };
  }

  const list = (releases.result && releases.result.list) || [];
  if (list.length === 0) {
    return { status: 'empty', items: [] };
  }

  // Find main integration version: earliest version whose latestIntegrateTime >= today
  const today = new Date().toISOString().slice(0, 10);
  const sorted = list
    .filter(v => v.latestIntegrateTime)
    .sort((a, b) => (a.versionSort || '').localeCompare(b.versionSort || ''));

  const mainVersion = sorted.find(v => {
    const intDate = v.latestIntegrateTime.split(' ')[0];
    return intDate >= today;
  });

  if (!mainVersion) {
    return { status: 'failed', error: 'cannot determine main integration version', items: [] };
  }

  // Get version index for ±1 range
  const allVersions = sorted.map(v => v.version);
  const mainIdx = allVersions.indexOf(mainVersion.version);
  const versionRange = allVersions.slice(
    Math.max(0, mainIdx - 1),
    Math.min(allVersions.length, mainIdx + 2)
  );

  // Step 2: query defects for each version
  const items = [];
  for (const version of versionRange) {
    const defectResult = core.runHuoban(
      `defect list --product-name=${product} --version=${version} --type=myHandle --page-size=${pageSize}`,
      { timeout: 30000 }
    );
    if (!defectResult.ok) continue;

    let defectData;
    try {
      defectData = JSON.parse(defectResult.stdout);
    } catch (_) {
      continue;
    }

    const defectList = (defectData.result && defectData.result.list) || [];
    for (const d of defectList) {
      items.push({
        id: d.defectId || d.id,
        title: d.title || '未知',
        status: (d.status && d.status.name) || '未知',
        priority: (d.priority && d.priority.name) || '未知',
        severity: (d.severity && d.severity.name) || '未知',
        platform: (d.platform && d.platform.name) || '未知',
        module: (d.module && d.module.name) || '未知',
        assignee: d.handlerDisplayName || d.assignerDisplayName || '未指派',
        client_version: d.clientVersion || '未知',
        created_at: d.createTime || '未知',
        url: d.defectId ? `https://huoban.alipay.com/defect/${d.defectId}` : '未知',
        version
      });
    }
  }

  return { status: items.length > 0 ? 'ok' : 'empty', items };
}

function queryDima() {
  const dimaCheck = isDimaAvailableWithStaff();
  if (!dimaCheck.available) {
    return { status: 'failed', error: dimaCheck.reason, items: [] };
  }

  // Get user's spaces
  const spaceResult = core.runDima('space list --member -o json', { timeout: 30000 });
  if (!spaceResult.ok) {
    return { status: 'failed', error: 'failed to list spaces', items: [] };
  }

  let spaceIds = [];
  try {
    const spaceData = JSON.parse(spaceResult.stdout);
    if (Array.isArray(spaceData)) {
      spaceIds = spaceData.map(s => s.workspaceId || s.id).filter(Boolean);
    } else if (spaceData.data && Array.isArray(spaceData.data)) {
      spaceIds = spaceData.data.map(s => s.workspaceId || s.id).filter(Boolean);
    }
  } catch (_) {
    // Fallback: regex extract
    const matches = spaceResult.stdout.match(/"workspaceId"\s*:\s*"([^"]+)"/g);
    if (matches) {
      spaceIds = matches.map(m => m.match(/"([^"]+)"$/)[1]);
    }
  }

  if (spaceIds.length === 0) {
    return { status: 'empty', items: [] };
  }

  const staffId = dimaCheck.staff_id;
  const items = [];

  for (const spaceId of spaceIds) {
    const processorArg = staffId ? ` --processor ${staffId}` : '';
    const bugResult = core.runDima(
      `bug list -s ${spaceId}${processorArg} -o json`,
      { timeout: 30000 }
    );
    if (!bugResult.ok) continue;

    let bugData;
    try {
      bugData = JSON.parse(bugResult.stdout);
    } catch (_) {
      continue;
    }

    const bugList = Array.isArray(bugData) ? bugData
      : (bugData.data && Array.isArray(bugData.data)) ? bugData.data
      : [];

    for (const b of bugList) {
      items.push({
        id: b.workItemId || b.id || b.identifier,
        title: b.subject || b.title || '未知',
        status: b.statusName || (b.status && b.status.name) || '未知',
        priority: b.priorityName || (b.priority && b.priority.name) || '未知',
        severity: b.severityName || (b.severity && b.severity.name) || '未知',
        platform: '未知',
        module: '未知',
        assignee: b.processorName || b.assigneeName || '未指派',
        client_version: '未知',
        created_at: b.createdAt || b.createTime || '未知',
        url: b.workItemId ? `https://dima.alipay.com/workitem/${b.workItemId}` : '未知'
      });
    }
  }

  return { status: items.length > 0 ? 'ok' : 'empty', items };
}

// ---------- get ----------

function cmdGet(opts) {
  if (!opts.id) {
    process.stderr.write('Error: <id> required\n');
    process.exit(1);
  }
  if (!opts.source || !['huoban', 'dima'].includes(opts.source)) {
    process.stderr.write('Error: --source huoban|dima required\n');
    process.exit(1);
  }

  if (opts.source === 'huoban') {
    getHuobanDetail(opts.id);
  } else {
    getDimaDetail(opts.id);
  }
}

function getHuobanDetail(defectId) {
  const r = core.runHuoban(`defect get --id=${defectId}`, { timeout: 30000 });
  if (!r.ok) {
    emit({ ok: false, error: r.stderr.split('\n')[0] || `exit ${r.exitCode}` });
    return;
  }

  let data;
  try {
    const parsed = JSON.parse(r.stdout);
    data = parsed.result;
    if (Array.isArray(data)) data = data[0];
  } catch (_) {
    emit({ ok: false, error: 'failed to parse huoban response' });
    return;
  }

  if (!data) {
    emit({ ok: false, error: 'empty result from huoban' });
    return;
  }

  emit({
    ok: true,
    source: 'huoban',
    id: data.defectId || defectId,
    title: data.title || '未知',
    status: (data.status && data.status.name) || '未知',
    priority: (data.priority && data.priority.name) || '未知',
    severity: (data.severity && data.severity.name) || '未知',
    platform: (data.platform && data.platform.name) || '未知',
    module: (data.module && data.module.name) || '未知',
    description: data.description || '无',
    assignee: data.handlerDisplayName || data.assignerDisplayName || '未指派',
    reporter: data.reporterDisplayName || '未知',
    client_version: data.clientVersion || '未知',
    created_at: data.createTime || '未知',
    url: `https://huoban.alipay.com/defect/${data.defectId || defectId}`,
    custom_fields: {
      classify: (data.classify && data.classify.name) || '未知'
    }
  });
}

function getDimaDetail(workItemId) {
  const r = core.runDima(`bug get ${workItemId} --with-custom-fields -o json`, { timeout: 30000 });
  if (!r.ok) {
    emit({ ok: false, error: r.stderr.split('\n')[0] || `exit ${r.exitCode}` });
    return;
  }

  let data;
  try {
    data = JSON.parse(r.stdout);
    if (data.data) data = data.data;
  } catch (_) {
    emit({ ok: false, error: 'failed to parse dima response' });
    return;
  }

  if (!data) {
    emit({ ok: false, error: 'empty result from dima' });
    return;
  }

  emit({
    ok: true,
    source: 'dima',
    id: data.workItemId || data.id || data.identifier || workItemId,
    title: data.subject || data.title || '未知',
    status: data.statusName || (data.status && data.status.name) || '未知',
    priority: data.priorityName || (data.priority && data.priority.name) || '未知',
    severity: data.severityName || (data.severity && data.severity.name) || '未知',
    platform: '未知',
    module: '未知',
    description: data.description || data.desc || '无',
    assignee: data.processorName || data.assigneeName || '未指派',
    reporter: data.creatorName || data.reporterName || '未知',
    client_version: '未知',
    created_at: data.createdAt || data.createTime || '未知',
    url: `https://dima.alipay.com/workitem/${data.workItemId || workItemId}`,
    custom_fields: data.customFields || {}
  });
}

// ---------- exports & main ----------

function main(externalArgs) {
  if (externalArgs) {
    process.argv = ['node', 'query-defects', ...externalArgs];
  }
  const opts = parseArgs();
  if (opts.sub === 'probe') cmdProbe();
  else if (opts.sub === 'query') cmdQuery(opts);
  else cmdGet(opts);
}

module.exports = { main };

if (require.main === module) {
  main();
}
