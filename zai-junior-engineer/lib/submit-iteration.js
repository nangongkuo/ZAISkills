#!/usr/bin/env node

/**
 * submit-iteration - 迭代关联与打包（提交发布阶段 Step 3）
 *
 * 用法:
 *   acs-junior submit iteration probe <repo>
 *     — 探测: huoban 可用性、平台、4 层 module-id 推断、列出 sprints
 *
 *   acs-junior submit iteration apply <repo> --branch <name> --decision <skip|associate|create> [...]
 *     — 执行: 调 huoban-cli sprint module add + package build
 *     — 失败 fall back 为 warning 字段（不中断），最终输出 outputs_for_advance
 */

const path = require('path');
const core = require('./junior-core');

function parseArgs() {
  const args = process.argv.slice(2);
  const sub = args[0];
  const opts = {
    sub,
    repo_path: '',
    branch: '',
    decision: '',
    sprint_id: '',
    module_id: '',
    platform: '',
    version: '1.0.0',
    product: 'wallet'
  };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--branch') opts.branch = args[++i];
    else if (a === '--decision') opts.decision = args[++i];
    else if (a === '--sprint-id') opts.sprint_id = args[++i];
    else if (a === '--module-id') opts.module_id = args[++i];
    else if (a === '--platform') opts.platform = args[++i];
    else if (a === '--version') opts.version = args[++i];
    else if (a === '--product') opts.product = args[++i];
    else if (!a.startsWith('-')) opts.repo_path = a;
  }
  if (!opts.sub || !['probe', 'apply'].includes(opts.sub)) {
    process.stderr.write('Usage:\n');
    process.stderr.write('  submit-iteration probe <repo>\n');
    process.stderr.write('  submit-iteration apply <repo> --branch X --decision skip|associate|create [...]\n');
    process.exit(1);
  }
  if (!opts.repo_path) {
    process.stderr.write('Error: <repo_path> required\n');
    process.exit(1);
  }
  return opts;
}

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

// ----- probe -----

// 层: 用 git remote 的 group/project 直接查 module（最精确，无需读构建文件）
function inferModuleIdLayerGitProject(repoPath) {
  const groupName = core.inferGitGroupName(repoPath);
  const projectName = core.getRepoName(repoPath);
  if (!groupName || !projectName) {
    return { value: null, source: null,
      detail: `git info missing: group=${groupName || 'null'}, project=${projectName || 'null'}` };
  }
  const r = core.runHuoban(
    `module get --group-name=${groupName} --project-name=${projectName}`,
    { timeout: 15000 }
  );
  if (!r.ok) {
    return { value: null, source: null,
      detail: `module get failed: ${r.stderr.split('\n')[0]}` };
  }
  // 返回 JSON，优先解析；失败再退回正则
  try {
    const obj = JSON.parse(r.stdout);
    const id = obj.moduleId || obj.id || (obj.data && (obj.data.moduleId || obj.data.id));
    if (id) {
      return { value: String(id),
        source: `module-get (group=${groupName}, project=${projectName})` };
    }
  } catch (_) {}
  const m = r.stdout.match(/moduleId\s*[:=]\s*["']?([^"'\s,}]+)/);
  if (m) {
    return { value: m[1],
      source: `module-get (group=${groupName}, project=${projectName})` };
  }
  return { value: null, source: null,
    detail: 'module get returned but no moduleId field' };
}

function inferModuleIdLayer2(repoPath, platform) {
  const artifact = core.extractArtifactId(repoPath, platform);
  const groupId = core.inferGroupId(repoPath, platform);
  if (!artifact || !groupId) {
    return { value: null, source: null,
      detail: `extract: ${artifact ? artifact.value : 'null'}, group: ${groupId || 'null'}` };
  }
  // 调 huoban-cli bundle list 精确查询
  const r = core.runHuoban(
    `bundle list --group-id=${groupId} --artifact-id=${artifact.value} --version=1.0.0`,
    { timeout: 15000 }
  );
  if (!r.ok) {
    return { value: null, source: null,
      detail: `bundle list failed: ${r.stderr.split('\n')[0]}` };
  }
  // 解析输出: 取首条命中的 moduleId（按行扫描 "moduleId: xxx"）
  const m = r.stdout.match(/moduleId\s*[:=]\s*["']?([^"'\s,}]+)/);
  if (m) {
    return { value: m[1], source: `layer2 (artifact=${artifact.value}, group=${groupId})` };
  }
  return { value: null, source: null, detail: 'bundle list returned but no moduleId field' };
}

function inferModuleIdLayer3(repoPath, platform) {
  const repoName = core.getRepoName(repoPath);
  const r = core.runHuoban(
    `metadata bundle search --keyword=${repoName} --platform=${platform}`,
    { timeout: 15000 }
  );
  if (!r.ok) {
    return { value: null, source: null,
      detail: `metadata search failed: ${r.stderr.split('\n')[0]}` };
  }
  // 仅在唯一匹配时返回
  const matches = r.stdout.match(/moduleId\s*[:=]\s*["']?([^"'\s,}]+)/g);
  if (matches && matches.length === 1) {
    const m = matches[0].match(/moduleId\s*[:=]\s*["']?([^"'\s,}]+)/);
    return { value: m[1], source: `layer3 (search keyword=${repoName})` };
  }
  return {
    value: null,
    source: null,
    detail: matches ? `metadata search returned ${matches.length} matches (need exactly 1)` : 'no matches'
  };
}

function listSprints(productName, version) {
  const r = core.runHuoban(
    `sprint list --product-name=${productName} --version=${version}`,
    { timeout: 15000 }
  );
  if (!r.ok) return { sprints: [], error: r.stderr.split('\n')[0] };
  // 简单解析: 每行 id\tname 或 JSON 数组
  const sprints = [];
  try {
    const parsed = JSON.parse(r.stdout);
    if (Array.isArray(parsed)) {
      for (const s of parsed) {
        if (s.id || s.projectUniqueId) {
          sprints.push({
            id: s.id || s.projectUniqueId,
            name: s.name || s.title || '',
            version: s.version || version
          });
        }
      }
      return { sprints };
    }
  } catch (_) {}
  // 返回正则扫描
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*([a-zA-Z0-9_-]+)\s+(.+)$/);
    if (m) sprints.push({ id: m[1], name: m[2].trim(), version });
  }
  return { sprints };
}

function cmdProbe(opts) {
  const huoban = core.isHuobanAvailable();
  if (!huoban.available) {
    return emit({
      huoban_available: false,
      skip_reason: `huoban-cli unavailable: ${huoban.reason}`,
      next_step: 'Skip iteration. Pass advance --outputs stage_8_sprint_id=未触发 stage_8_build_result=未触发 stage_8_build_url=N/A'
    });
  }

  const platform = core.detectSubmitPlatform(opts.repo_path);
  if (!platform) {
    return emit({
      huoban_available: true,
      platform: null,
      skip_reason: 'platform not inferable (no build.gradle / Podfile / hxiconfile.ts)',
      next_step: 'Skip iteration. Pass advance --outputs stage_8_sprint_id=未触发 stage_8_build_result=未触发 stage_8_build_url=N/A'
    });
  }

  // 模块 ID 推断（全自动，失败即 skip,不询问用户）
  const attempts = {
    layer1_repo_config: null,
    layer2_module_get: null,
    layer3_bundle_list: null,
    layer4_metadata_search: null
  };
  let moduleId = null;
  let moduleIdSource = null;

  const l1 = core.readModuleIdLayer1(opts.repo_path);
  if (l1) {
    attempts.layer1_repo_config = l1.value;
    moduleId = l1.value;
    moduleIdSource = `layer1 (${l1.source})`;
  }

  if (!moduleId) {
    const l2 = inferModuleIdLayerGitProject(opts.repo_path);
    attempts.layer2_module_get = l2.value || l2.detail;
    if (l2.value) {
      moduleId = l2.value;
      moduleIdSource = l2.source;
    }
  }

  if (!moduleId) {
    const l3 = inferModuleIdLayer2(opts.repo_path, platform);
    attempts.layer3_bundle_list = l3.value || l3.detail;
    if (l3.value) {
      moduleId = l3.value;
      moduleIdSource = l3.source;
    }
  }

  if (!moduleId) {
    const l4 = inferModuleIdLayer3(opts.repo_path, platform);
    attempts.layer4_metadata_search = l4.value || l4.detail;
    if (l4.value) {
      moduleId = l4.value;
      moduleIdSource = l4.source;
    }
  }

  // module-id 全自动失败即 skip,不再让用户输入
  if (!moduleId) {
    return emit({
      huoban_available: true,
      platform,
      module_id: null,
      module_id_attempts: attempts,
      skip_reason: 'module-id 自动推断失败（已尝试本地配置 / module get / bundle list / metadata search）',
      next_step: 'Skip iteration. Pass advance --outputs stage_8_sprint_id=未触发 stage_8_build_result=未触发 stage_8_build_url=N/A'
    });
  }

  const sprintsResult = listSprints(opts.product, opts.version);

  const result = {
    huoban_available: true,
    platform,
    module_id: moduleId,
    module_id_source: moduleIdSource,
    module_id_attempts: attempts,
    product_name: opts.product,
    version: opts.version,
    existing_sprints: sprintsResult.sprints,
    sprints_query_warning: sprintsResult.error || null,
    next_step: 'AskUserQuestion: associate existing / create new / skip'
  };
  emit(result);
}

// ----- apply -----

function buildSkipOutput() {
  return {
    ok: true,
    decision: 'skip',
    sprint_id: '跳过',
    associate_status: 'skipped',
    associate_warning: null,
    build_result: '跳过',
    build_warning: null,
    build_url: 'N/A',
    outputs_for_advance: {
      stage_8_sprint_id: '跳过',
      stage_8_build_result: '跳过',
      stage_8_build_url: 'N/A'
    }
  };
}

function doSprintModuleAdd(sprintId, moduleId, branch) {
  const r = core.runHuoban(
    `sprint module add --project-unique-id=${sprintId} --module-id=${moduleId} --branch-name=${branch}`,
    { timeout: 30000 }
  );
  return {
    status: r.ok ? 'success' : 'warning',
    warning: r.ok ? null : (r.stderr.split('\n')[0] || `exit ${r.exitCode}`)
  };
}

function doPackageBuild(sprintId, platform, productName) {
  const r = core.runHuoban(
    `package build --project-unique-id=${sprintId} --platform=${platform} ` +
    `--type=test --product-name=${productName} --if-not-exists`,
    { timeout: 60000 }
  );
  if (!r.ok) {
    return { result: '失败', warning: r.stderr.split('\n')[0] || `exit ${r.exitCode}`, url: 'N/A' };
  }
  // 解析 build_request_id 与 url
  let result = null;
  let url = 'N/A';
  const idMatch = r.stdout.match(/build[_-]?request[_-]?id["'\s:=]+([a-zA-Z0-9_-]+)/i);
  if (idMatch) result = idMatch[1];
  const urlMatch = r.stdout.match(/https?:\/\/\S+/);
  if (urlMatch) url = urlMatch[0];
  return { result: result || '触发成功', warning: null, url };
}

function doSprintCreate(productName, version) {
  const r = core.runHuoban(
    `sprint create --product-name=${productName} --version=${version}`,
    { timeout: 30000 }
  );
  if (!r.ok) {
    return { ok: false, error: r.stderr.split('\n')[0] || `exit ${r.exitCode}` };
  }
  let id = null;
  const m = r.stdout.match(/(?:projectUniqueId|sprint[_-]?id|id)["'\s:=]+([a-zA-Z0-9_-]+)/i);
  if (m) id = m[1];
  return id ? { ok: true, sprint_id: id } : { ok: false, error: 'create succeeded but id not parsed' };
}

function cmdApply(opts) {
  if (opts.decision === 'skip') {
    return emit(buildSkipOutput());
  }
  if (!['associate', 'create'].includes(opts.decision)) {
    process.stderr.write(`Error: --decision must be skip|associate|create (got: ${opts.decision})\n`);
    process.exit(1);
  }
  if (!opts.module_id) {
    process.stderr.write('Error: --module-id required for associate/create\n');
    process.exit(1);
  }
  if (!opts.platform) {
    process.stderr.write('Error: --platform required for associate/create\n');
    process.exit(1);
  }
  if (!opts.branch) {
    process.stderr.write('Error: --branch required for associate/create\n');
    process.exit(1);
  }

  let sprintId = opts.sprint_id;
  let createWarning = null;

  if (opts.decision === 'create') {
    const r = doSprintCreate(opts.product, opts.version);
    if (!r.ok) {
      return emit({
        ok: true,
        decision: 'create',
        sprint_id: '失败',
        associate_status: 'failed',
        associate_warning: `sprint create failed: ${r.error}`,
        build_result: '未触发',
        build_warning: null,
        build_url: 'N/A',
        outputs_for_advance: {
          stage_8_sprint_id: '失败',
          stage_8_build_result: '未触发',
          stage_8_build_url: 'N/A'
        }
      });
    }
    sprintId = r.sprint_id;
  } else if (!sprintId) {
    process.stderr.write('Error: --sprint-id required for --decision associate\n');
    process.exit(1);
  }

  // sprint module add
  const assoc = doSprintModuleAdd(sprintId, opts.module_id, opts.branch);

  // package build — 即使 associate 是 warning 也尝试 build（按散文规范）
  const build = doPackageBuild(sprintId, opts.platform, opts.product);

  emit({
    ok: true,
    decision: opts.decision,
    sprint_id: sprintId,
    associate_status: assoc.status,
    associate_warning: assoc.warning,
    build_result: build.result,
    build_warning: build.warning,
    build_url: build.url,
    outputs_for_advance: {
      stage_8_sprint_id: sprintId,
      stage_8_build_result: build.result,
      stage_8_build_url: build.url
    }
  });
}

function main() {
  const opts = parseArgs();
  if (opts.sub === 'probe') cmdProbe(opts);
  else cmdApply(opts);
}

main();
