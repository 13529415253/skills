#!/usr/bin/env node
/**
 * plan-mode：管理项目级计划模式提示词、计划自检和非破坏式视图重建。
 *
 * 用法：node plan-mode.mjs <install|remove|sync|check>
 *
 * @author wululu
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(process.cwd());
const planningRoot = join(projectRoot, '.planning');
const activePath = join(planningRoot, 'active.json');
const agentsPath = join(projectRoot, 'AGENTS.md');
const overridePath = join(projectRoot, 'AGENTS.override.md');
const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corePath = join(toolRoot, 'plan', 'plan-core.md');
const builderPath = join(toolRoot, 'bin', 'plan-build.mjs');
const BEGIN = '<!-- PLAN-MODE:BEGIN -->';
const END = '<!-- PLAN-MODE:END -->';

/**
 * 读取当前项目的计划模式状态。
 */
function readActive() {
  if (!existsSync(activePath)) return null;
  try {
    return JSON.parse(readFileSync(activePath, 'utf8'));
  } catch (error) {
    throw new Error(`active.json 解析失败：${error.message}`);
  }
}

/**
 * 只检查计划模式开关和需求字段，不要求计划目录已经创建。
 */
function requireActiveMode() {
  const active = readActive();
  if (!active || active.mode !== 'active') {
    throw new Error('当前未开启计划模式，安全锁拒绝同步 AGENTS.md');
  }
  if (!active['需求']) throw new Error('active.json 缺少“需求”字段，安全锁拒绝继续');
  return active;
}

/**
 * 要求当前项目已开启计划模式且计划目录结构完整。
 */
function requireActive() {
  const active = requireActiveMode();
  const requirementDir = join(planningRoot, active['需求']);
  if (!existsSync(join(requirementDir, 'index.md'))) {
    throw new Error(`未找到计划索引：${join(requirementDir, 'index.md')}，安全锁拒绝继续`);
  }
  return { active, requirementDir };
}

/**
 * 读取核心提示词并生成受管控的 AGENTS.md 区块。
 */
function managedBlock() {
  if (!existsSync(corePath)) throw new Error(`未找到核心提示词：${corePath}`);
  const core = readFileSync(corePath, 'utf8').trim();
  return `${BEGIN}\n${core}\n${END}`;
}

/**
 * 在项目 AGENTS.md 中幂等安装或更新计划模式区块。
 */
function installAgentsBlock() {
  const block = managedBlock();
  const existed = existsSync(agentsPath);
  const original = existed ? readFileSync(agentsPath, 'utf8') : '';
  const pattern = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`, 'g');
  const next = original.includes(BEGIN) && original.includes(END)
    ? original.replace(pattern, block)
    : `${original}${original ? (original.endsWith('\n') ? '\n' : '\n\n') : ''}${block}\n`;
  writeFileSync(agentsPath, next);
  if (existsSync(overridePath)) {
    console.warn(`⚠️ 当前项目存在 ${overridePath}；Pi 会优先加载它，请确认计划区块是否需要同步到该文件。`);
  }
  console.log(`✅ 已同步计划模式核心提示词到 ${agentsPath}`);
}

/**
 * 从项目 AGENTS.md 中移除计划模式区块，并保留其他项目规则。
 */
function removeAgentsBlock() {
  const active = readActive();
  if (active?.mode === 'active') {
    throw new Error('计划模式仍为 active，安全锁拒绝移除 AGENTS.md 区块；请先执行 /plan-off');
  }
  if (!existsSync(agentsPath)) {
    console.log(`ℹ️ ${agentsPath} 不存在，无需移除计划模式区块`);
    return;
  }
  const original = readFileSync(agentsPath, 'utf8');
  const pattern = new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`, 'g');
  const next = original.replace(pattern, '');
  writeFileSync(agentsPath, next);
  console.log(`✅ 已从 ${agentsPath} 移除计划模式核心提示词，其他内容保留`);
}

/**
 * 对正则特殊字符进行转义。
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将计划状态文本归一化，供 active/index/步骤标题一致性检查使用。
 */
function normalizeStatus(value) {
  if (/(?:✅|已完成)/.test(value)) return 'done';
  if (/(?:🟢|🚧|可实施|实施中)/.test(value)) return 'active';
  if (/(?:🟦|待讨论)/.test(value)) return 'discussion';
  if (/(?:⛔|阻塞)/.test(value)) return 'blocked';
  return null;
}

/**
 * 解析 Markdown 表格，支持在同一小节中存在多张表。
 */
function parseMarkdownTables(text, requiredHeaders = []) {
  const lines = text.split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|[\s:|-]+\|/.test(lines[i + 1])) continue;
    const headers = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (!requiredHeaders.every((header) => headers.includes(header))) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      rows.push(lines[j].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
    }
    tables.push({ headers, rows });
    i += rows.length + 1;
  }
  return tables;
}

/**
 * 取出指定二级标题下的内容，不包含下一个二级标题。
 */
function sectionBody(text, title) {
  return text.match(new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm'))?.[1] || '';
}

/**
 * 解析步骤总表并执行计划结构与批次 Review 的非破坏式检查。
 */
function checkPlan(requirementDir, active = readActive()) {
  const errors = [];
  const warnings = [];
  const indexPath = join(requirementDir, 'index.md');
  const index = readFileSync(indexPath, 'utf8');
  if (!index.includes('| 步骤 |') || !index.includes('| 状态 |') || !index.includes('| 文件 |')) {
    errors.push('index.md 缺少固定步骤总表表头');
  }
  if (!existsSync(join(requirementDir, 'anchors.md'))) {
    warnings.push('缺少 anchors.md，锚点引用将无法完成需求原文回溯');
  }
  const indexCurrentStep = index.match(/^\|\s*当前重点步骤\s*\|\s*(S\d+)/m)?.[1];
  if (active?.['当前步骤'] && indexCurrentStep && active['当前步骤'] !== indexCurrentStep) {
    errors.push(`当前步骤不一致：active.json=${active['当前步骤']}，index.md 元信息=${indexCurrentStep}`);
  }

  const stepRows = index.split('\n').filter((line) => /^\|\s*S\d+\s*\|/.test(line));
  for (const line of stepRows) {
    const cells = line.split('|').map((cell) => cell.trim());
    const stepId = cells[1];
    const relativePath = cells[4];
    if (!relativePath) {
      errors.push(`${stepId} 缺少步骤文件路径`);
      continue;
    }
    const stepPath = join(requirementDir, relativePath);
    if (!existsSync(stepPath)) {
      errors.push(`${stepId} 步骤文件不存在：${relativePath}`);
      continue;
    }
    const step = readFileSync(stepPath, 'utf8');
    const stepStatus = cells[3] || '';
    const stepHeading = step.match(/^#\s+S\d+\s*[：:]([^\n]*)/m)?.[1] || '';
    const indexStatusKind = normalizeStatus(stepStatus);
    const headingStatusKind = normalizeStatus(stepHeading);
    if (indexStatusKind && headingStatusKind && indexStatusKind !== headingStatusKind) {
      errors.push(`${stepId} 状态不一致：index.md=${stepStatus}，步骤标题=${stepHeading.trim()}`);
    }
    if (!step.includes('## 责任与协作')) warnings.push(`${stepId} 缺少“责任与协作”小节`);
    const discussionSection = sectionBody(step, '待讨论点');
    const discussionTables = parseMarkdownTables(discussionSection, ['编号', '状态']);
    const discussionRows = discussionTables.flatMap((table) => {
      const statusIndex = table.headers.indexOf('状态');
      return table.rows.map((row) => ({ status: row[statusIndex] || '' }));
    });
    const pendingDiscussionRows = discussionRows.filter((row) => /^(?:待讨论|讨论中|待确认)/.test(row.status));
    const interfaceSection = discussionSection.match(/^###\s+待讨论接口设计\s*$\n([\s\S]*?)(?=^###\s+|^##\s+|(?![\s\S]))/m)?.[1] || '';
    const codeSection = discussionSection.match(/^###\s+待讨论代码设计\s*$\n([\s\S]*?)(?=^###\s+|^##\s+|(?![\s\S]))/m)?.[1] || '';
    const isImplementationStep = indexStatusKind === 'active';
    if (isImplementationStep) {
      if (!discussionSection) {
        errors.push(`${stepId} 进入实施前缺少“待讨论点”小节`);
      } else if (pendingDiscussionRows.length) {
        errors.push(`${stepId} 仍有 ${pendingDiscussionRows.length} 个待确认讨论点，不能进入实施`);
      }
      if (!interfaceSection) {
        errors.push(`${stepId} 进入实施前缺少“待讨论接口设计”子项`);
      } else {
        const interfaceTables = parseMarkdownTables(interfaceSection, ['编号', '类型', '状态']);
        if (!interfaceTables.length && !/无接口(?:新增、修改、删除或复用登记|变化)/.test(interfaceSection)) {
          errors.push(`${stepId} 的“待讨论接口设计”缺少可解析表格或明确的无接口变化声明`);
        }
      }
      if (!codeSection) {
        errors.push(`${stepId} 进入实施前缺少“待讨论代码设计”子项`);
      } else {
        const codeTables = parseMarkdownTables(codeSection, ['编号', '类型', '页面/组件/函数', '状态']);
        if (!codeTables.length && !/无代码结构变更/.test(codeSection)) {
          errors.push(`${stepId} 的“待讨论代码设计”缺少可解析表格或明确的无结构变化声明`);
        }
      }
    }
    const batchSection = step.match(/^##\s+实施批次\s*\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/m);
    if (!batchSection) {
      warnings.push(`${stepId} 尚未声明实施批次；若已进入实施阶段，应补充批次表`);
      continue;
    }
    const batchLines = batchSection[1].split('\n').filter((line) => line.trim().startsWith('|'));
    if (batchLines.length < 3) {
      warnings.push(`${stepId} 的“实施批次”小节缺少可解析的批次表`);
      continue;
    }
    const batchHeaders = batchLines[0].split('|').map((cell) => cell.trim());
    const batchStatusIndex = batchHeaders.indexOf('状态');
    const batchReviewIndex = batchHeaders.indexOf('Review');
    if (batchStatusIndex < 0 || batchReviewIndex < 0) {
      errors.push(`${stepId} 实施批次表必须包含“状态”和“Review”列`);
      continue;
    }
    const completedBatches = batchLines.slice(2).map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((row) => /(?:✅|已完成)/.test(row[batchStatusIndex] || ''));
    if (completedBatches.length && /(?:🟦|待讨论)/.test(stepStatus)) {
      errors.push(`${stepId} 已有完成批次，但步骤状态仍为待讨论，应改为🚧实施中或✅已完成`);
    }
    for (const row of completedBatches) {
      const reviewPath = row[batchReviewIndex];
      if (!reviewPath || !existsSync(join(requirementDir, reviewPath))) {
        errors.push(`${stepId} 已完成批次缺少 Review 文件：${reviewPath || '未填写'}`);
        continue;
      }
      const reviewContent = readFileSync(join(requirementDir, reviewPath), 'utf8');
      const graphTitle = '页面与组件脉络图';
      const graphSection = reviewContent.match(new RegExp(`^##\\s+${graphTitle}\\s*\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm'));
      if (!graphSection || !graphSection[1].includes('```mermaid')) {
        errors.push(`${stepId} Review 缺少图优先内容：${graphTitle}（该小节需包含 mermaid）`);
      }
      if (interfaceSection) {
        const changeSection = sectionBody(reviewContent, '接口变更清单');
        const changeTables = parseMarkdownTables(changeSection, ['类型', '请求方法/路径', '设计方案', '实际实现', '字段变化', '兼容性', '前端动作']);
        if (!changeSection || (!changeTables.length && !/无接口变化/.test(changeSection))) {
          errors.push(`${stepId} Review 缺少可核对的“接口变更清单”（需包含表格或明确无接口变化）`);
        }
      }
      if (codeSection) {
        const structureSection = sectionBody(reviewContent, '代码结构与调用清单');
        const structureTables = parseMarkdownTables(structureSection, ['页面/组件/函数', '实际职责', '调用入口/时机', 'Props/参数/返回值', '内部流程', '状态/副作用/边界']);
        if (!structureSection || (!structureTables.length && !/无代码结构变更/.test(structureSection))) {
          errors.push(`${stepId} Review 缺少可核对的“代码结构与调用清单”（需包含表格或明确无结构变化）`);
        }
        const understandingSection = sectionBody(reviewContent, '理解验收');
        if (!understandingSection || !/验收结论\s*[：:]\s*通过/.test(understandingSection)) {
          errors.push(`${stepId} Review 缺少“理解验收”通过记录`);
        }
      }
    }
  }
  return { errors, warnings };
}

/**
 * 输出自检结果，并返回是否存在阻断性错误。
 */
function reportCheck(result) {
  result.errors.forEach((message) => console.error(`❌ ${message}`));
  result.warnings.forEach((message) => console.warn(`⚠️ ${message}`));
  if (!result.errors.length && !result.warnings.length) console.log('✅ 计划自检通过');
  return result.errors.length === 0;
}

/**
 * 调用计划构建器生成 HTML，不改写计划源文件。
 */
function build(requirementDir) {
  const result = spawnSync(process.execPath, [builderPath, requirementDir], { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`计划 HTML 构建失败，退出码：${result.status}`);
}

const command = process.argv[2] || 'check';
try {
  if (command === 'install') {
    requireActiveMode();
    installAgentsBlock();
  } else if (command === 'remove') {
    removeAgentsBlock();
  } else if (command === 'check') {
    const { requirementDir } = requireActive();
    if (!reportCheck(checkPlan(requirementDir, readActive()))) process.exitCode = 1;
  } else if (command === 'sync') {
    const { requirementDir } = requireActive();
    const passed = reportCheck(checkPlan(requirementDir, readActive()));
    if (!passed) {
      process.exitCode = 1;
    } else {
      installAgentsBlock();
      build(requirementDir);
    }
  } else {
    throw new Error(`未知命令：${command}。可用命令：install、remove、sync、check`);
  }
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
