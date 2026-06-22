#!/usr/bin/env node

/**
 * 动态生成 OpenSpec config.yaml
 *
 * 用途:
 *   根据 Knowledge Index 匹配结果，动态生成包含知识文档的 config.yaml
 *   使 OpenSpec 在生成提案时能参考相关知识
 *
 * 调用方式:
 *   node generate-config.js \
 *     --repo-path <仓库路径> \
 *     --platform <平台类型> \
 *     --yuque-doc-file <系分文档文件路径> \
 *     --knowledge-paths <知识路径1>,<知识路径2>
 *
 * 输出:
 *   写入 <repo_path>/openspec/schemas/acs-spec/config.yaml
 */

const fs = require('fs');
const path = require('path');

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    repo_path: '',
    platform: 'auto',
    yuque_doc_file: '',
    knowledge_paths: [],
    overview_path: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo-path' && i + 1 < args.length) {
      options.repo_path = args[++i];
    } else if (arg === '--platform' && i + 1 < args.length) {
      options.platform = args[++i];
    } else if (arg === '--yuque-doc-file' && i + 1 < args.length) {
      options.yuque_doc_file = args[++i];
    } else if (arg === '--knowledge-paths' && i + 1 < args.length) {
      options.knowledge_paths = args[++i].split(',').filter(p => p.trim());
    } else if (arg === '--overview-path' && i + 1 < args.length) {
      options.overview_path = args[++i];
    }
  }

  return options;
}

/**
 * 读取文件内容
 */
function readFileContent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * 裁剪知识文档，只保留编码指导相关 section
 * 移除: frontmatter, Keywords, Use When, Evidence, Platform, Scanned Repos
 * 保留: 标题(H1), TL;DR, Preferred Entry, Import, Code Example,
 *       How To Use, Avoid Native Or Raw Usage, Constraints
 */
function trimForCoding(content) {
  // 移除 frontmatter
  content = content.replace(/^---\n[\s\S]*?\n---\n*/, '');

  const removeSections = new Set([
    'keywords', 'use when', 'evidence', 'platform', 'scanned repos'
  ]);

  const lines = content.split('\n');
  const result = [];
  let skip = false;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      const sectionName = h2Match[1].trim().toLowerCase();
      skip = removeSections.has(sectionName);
      if (!skip) result.push(line);
      continue;
    }
    if (!skip) result.push(line);
  }

  // 去除多余空行
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 读取知识文档内容
 */
function readKnowledgeContents(knowledgePaths) {
  const contents = [];

  for (const kpath of knowledgePaths) {
    if (fs.existsSync(kpath)) {
      const rawContent = fs.readFileSync(kpath, 'utf-8');
      const content = trimForCoding(rawContent);
      const title = path.basename(kpath, '.md');
      contents.push({
        title: title,
        path: kpath,
        content: content
      });
    }
  }

  return contents;
}

/**
 * 读取 Repo Overview 内容（仅移除 frontmatter，不做 trimForCoding 裁剪）
 * Overview 文档格式与 feature 文档不同，直接注入全文
 */
function readOverviewContent(overviewPath) {
  if (!overviewPath || !fs.existsSync(overviewPath)) return null;
  let content = fs.readFileSync(overviewPath, 'utf-8');
  content = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
  return content.trim();
}

/**
 * 转义 YAML 字符串中的特殊字符
 */
function escapeYamlString(str) {
  if (!str) return '';

  // 处理多行字符串，确保正确缩进
  return str;
}

/**
 * 生成 config.yaml 内容
 */
function generateConfigContent(options, yuqueDoc, knowledgeContents, overviewContent) {
  // 构建项目概要内容
  let overviewSection = '';
  if (overviewContent) {
    overviewSection = `  ## 项目概要\n\n${indentYaml(overviewContent, 4)}\n\n`;
  }

  // 构建知识文档内容
  let knowledgeSection = '';
  if (knowledgeContents.length > 0) {
    for (const k of knowledgeContents) {
      knowledgeSection += `### ${k.title}\n\n`;
      knowledgeSection += k.content;
      knowledgeSection += '\n\n---\n\n';
    }
  } else {
    knowledgeSection = '未匹配到相关知识文档\n\n';
  }

  // 构建 YAML 内容
  const config = `# ACS Spec Schema 配置
# 此文件由 acs-junior-engineer 在 Spec 锁定环节自动生成
# 生成时间: ${new Date().toISOString()}

schema: acs-spec

# =============================================================================
# 上下文 - 包含项目信息、系分文档、知识文档
# =============================================================================
context: |
  ## 项目信息
  仓库路径: ${options.repo_path}
  平台类型: ${options.platform}

${overviewSection}  ## 系分文档

${indentYaml(yuqueDoc, 4)}

  ## 知识文档（已按需加载完整内容）

${indentYaml(knowledgeSection, 4)}
  ## 知识优先级
  仓库知识文档 > 通用知识文档 > 默认行为

# =============================================================================
# 规则 - 阶段性约束
# =============================================================================
rules:
  proposal:
    - 聚焦"为什么"和"做什么"，不涉及"怎么做"
    - 保持简洁（1-2 页）
    - 实现细节属于 design.md
    - 必须参考知识文档中的 Preferred Entry
    - 避免使用知识文档中 Avoid Native Or Raw Usage 列出的方式
    - 注意知识文档中的 Constraints

  spec:
    - 使用 ADDED/MODIFIED/REMOVED 格式
    - 每个需求 MUST 至少包含一个场景（4 级标题）
    - 使用 SHALL/MUST 表达规范性要求
    - 技术方案必须符合知识文档推荐

  design:
    - **必须先搜索本地工程代码**，找到与需求相关的现有实现
    - 代码位置必须准确（文件路径），禁止写"待确认"
    - 关键代码片段必须完整（从现有代码中提取）
    - 优先参考现有实现方式
    - 遵循知识文档中的 How To Use 步骤
    - 注意知识文档中的 Constraints
    - 禁止返回任务耗时预估
    - 禁止告诉用户"需要手动查找"或"无法确定"

  apply:
    - 遵循知识文档中的编码规范
    - 使用知识文档推荐的实现方式
    - 禁止告诉用户"需要手动执行"或"无法完成"
    - 禁止跳过任何任务
    - 禁止输出"后续任务（需要手动执行）"
    - 在关键步骤插入日志，覆盖以下场景:
      1. 功能入口/出口 - 方法被调用时打印入参，返回时打印结果
      2. 分支决策点 - if/switch 走了哪条路径及判断依据
      3. 外部交互 - 网络请求发出/返回、数据库读写的关键参数和状态
      4. 状态变化 - 关键变量赋值、状态机转换的前后值
      5. 错误处理 - catch 块必须打印异常信息和上下文
    - 日志格式要求:
      1. 使用项目已有的日志工具（从知识文档或相关代码中识别），不要引入新的日志库
      2. 日志内容必须包含: 模块标识 + 操作描述 + 关键参数值
      3. 日志级别: 入口/出口用 Info，分支/状态用 Debug，错误用 Error
      4. 禁止在日志中打印敏感信息（密码、token、完整身份证号等）
`;

  return config;
}

/**
 * 缩进 YAML 多行字符串
 */
function indentYaml(str, spaces) {
  const indent = ' '.repeat(spaces);
  return str.split('\n').map(line => indent + line).join('\n');
}

/**
 * 将 skill 内置的 acs-spec schema 文件（schema.yaml + templates）同步到目标仓库。
 * 仅在目标文件不存在或内容不同时才写入，避免无意义的覆盖。
 */
function syncSchemaFiles(repoSchemaDir) {
  const builtinSchemaDir = path.join(__dirname, '..', 'openspec', 'schemas', 'acs-spec');

  const filesToSync = [
    'schema.yaml',
    'templates/proposal.md',
    'templates/spec.md',
    'templates/design.md',
    'templates/tasks.md'
  ];

  let synced = 0;
  for (const relPath of filesToSync) {
    const src = path.join(builtinSchemaDir, relPath);
    const dst = path.join(repoSchemaDir, relPath);

    if (!fs.existsSync(src)) continue;

    const srcContent = fs.readFileSync(src, 'utf-8');
    const dstDir = path.dirname(dst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf-8') !== srcContent) {
      fs.writeFileSync(dst, srcContent, 'utf-8');
      synced++;
    }
  }

  return synced;
}

/**
 * 主函数
 */
function main() {
  const options = parseArgs();

  // 验证必要参数
  if (!options.repo_path) {
    console.error('错误: 缺少 --repo-path 参数');
    process.exit(1);
  }

  // 读取系分文档
  let yuqueDoc = '';
  if (options.yuque_doc_file) {
    yuqueDoc = readFileContent(options.yuque_doc_file);
    if (!yuqueDoc) {
      console.warn('警告: 系分文档文件不存在或为空');
    }
  }

  // 读取知识文档
  const knowledgeContents = readKnowledgeContents(options.knowledge_paths);

  // 读取项目概要
  const overviewContent = readOverviewContent(options.overview_path);

  // 生成配置内容
  const configContent = generateConfigContent(options, yuqueDoc, knowledgeContents, overviewContent);

  // 确保 openspec/schemas/acs-spec 目录存在
  const schemaDir = path.join(options.repo_path, 'openspec', 'schemas', 'acs-spec');
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true });
  }

  // 同步内置 schema 文件（schema.yaml + templates），防止 partial shadow
  const synced = syncSchemaFiles(schemaDir);
  if (synced > 0) {
    console.log(`✓ schema 文件已同步 (${synced} 个文件)`);
  }

  // 写入配置文件到 schema 目录
  const configPath = path.join(schemaDir, 'config.yaml');
  fs.writeFileSync(configPath, configContent, 'utf-8');

  // 输出结果
  console.log('✓ config.yaml 已生成');
  console.log(`   路径: ${configPath}`);
  if (overviewContent) {
    console.log('   项目概要: 已注入');
  }
  console.log(`   注入知识: ${knowledgeContents.length} 条`);
  if (knowledgeContents.length > 0) {
    for (const k of knowledgeContents) {
      console.log(`   - ${k.title}`);
    }
  }

  return configPath;
}

// 执行主函数
if (require.main === module) {
  main();
}

module.exports = { generateConfigContent, readKnowledgeContents, readOverviewContent };
