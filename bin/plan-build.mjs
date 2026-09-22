#!/usr/bin/env node
/**
 * plan-build：把 .planning/<需求>/ 下的分片计划构建为单个 html 视图
 *
 * 用法：node plan-build.mjs <需求目录>
 *
 * 输入约定（文件协议）：
 *   index.md      —— 计划索引
 *   anchors.md    —— 需求原文锚点
 *   steps/*.md    —— 步骤片段
 *   review/*.md   —— 步骤审查单元（可选）
 *   ../active.json—— 计划模式状态
 *
 * 输出：<需求目录>/build/plan.html
 *
 * @author wululu
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] || '.');
if (!existsSync(join(dir, 'index.md'))) {
  console.error(`未找到 ${dir}/index.md，请确认需求目录`);
  process.exit(1);
}

const read = (p) => readFileSync(p, 'utf8');
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const indexMd = read(join(dir, 'index.md'));

/** 解析 Markdown 表格的一行。 */
const cells = (line) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** 在文本中找表头包含指定列名的全部表格。 */
function parseTables(text, requiredCols) {
  const lines = text.split('\n');
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    const headers = cells(lines[i]);
    if (!requiredCols.every((c) => headers.includes(c))) continue;
    if (!/^\s*\|[\s:|-]+\|/.test(lines[i + 1])) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]));
    tables.push({ headers, rows });
    i += rows.length + 1;
  }
  return tables;
}

/** 在文本中找表头包含指定列名的第一张表。 */
function parseTable(text, requiredCols) {
  return parseTables(text, requiredCols)[0] || null;
}

const stepTable = parseTable(indexMd, ['步骤', '状态', '文件']);
if (!stepTable) {
  console.error('index.md 中未找到步骤总表（表头需包含：步骤/名称/状态/文件）');
  process.exit(1);
}

const stepFileIndex = stepTable.headers.indexOf('文件');
const stepNameIndex = stepTable.headers.indexOf('名称');
const stepStatusIndex = stepTable.headers.indexOf('状态');
const steps = stepTable.rows
  .map((row) => ({
    id: row[0],
    name: row[stepNameIndex] || '',
    status: row[stepStatusIndex] || '',
    file: row[stepFileIndex],
    brief: row[row.length - 1] || '',
  }))
  .filter((step) => step.file && existsSync(join(dir, step.file)));

/* ---------- 讨论点聚合 ---------- */
const PENDING = ['待讨论', '讨论中'];
const discussions = [];
for (const step of steps) {
  const md = read(join(dir, step.file));
  const discussionStart = md.split(/^##\s+待讨论点\s*$/m)[1];
  if (!discussionStart) continue;
  const section = discussionStart.split(/^##\s+/m)[0];
  const tables = parseTables(section, ['编号', '状态']);
  for (const table of tables) {
    for (const row of table.rows) discussions.push({ step: step.id, headers: table.headers, row });
  }
}

let recentChanges = [];
const activePath = join(dir, '..', 'active.json');
if (existsSync(activePath)) {
  try {
    recentChanges = JSON.parse(read(activePath))['最近变更'] || [];
  } catch {
    recentChanges = [];
  }
}

const recentDiscussionIds = new Set(
  recentChanges.flatMap((change) => String(change).match(/T-\d+/g) || []),
);

/* ---------- 需求锚点解析 ---------- */
const anchorsPath = join(dir, 'anchors.md');
const anchorMap = new Map();
if (existsSync(anchorsPath)) {
  const anchorTable = parseTable(read(anchorsPath), ['锚点']);
  if (anchorTable) {
    const idIndex = anchorTable.headers.indexOf('锚点');
    for (const row of anchorTable.rows) {
      const id = row[idIndex];
      if (!id) continue;
      const data = {};
      anchorTable.headers.forEach((header, index) => { data[header] = row[index]; });
      anchorMap.set(id, data);
    }
  }
}

/* ---------- Markdown 渲染与目录收集 ---------- */
function slugify(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'section';
}

/**
 * 根据锚点记录生成鼠标悬浮时显示的需求摘要。
 */
function anchorTooltip(id) {
  const data = anchorMap.get(id);
  if (!data) return `查看锚点 ${id}`;
  const chapter = data['需求章节'] || '';
  const excerpt = data['原文摘录（≤2 句）'] || data['原文摘录'] || '';
  return [chapter, excerpt].filter(Boolean).join('：');
}

/**
 * 将已登记的锚点渲染为可点击按钮，并附带需求摘要提示。
 */
function renderAnchor(id) {
  if (!anchorMap.has(id)) return null;
  const tooltip = esc(anchorTooltip(id));
  return `<button class="anchor-tag" data-anchor="${esc(id)}" type="button" title="${tooltip}" aria-label="查看锚点 ${esc(id)}：${tooltip}">${esc(id)}</button>`;
}

function inline(text) {
  return esc(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([A-Z]{1,3}-\d{1,3})\]|(?<![\w-])([A-Z]{1,3}-\d{1,3})(?![\w-])/g, (m, bracketId, bareId) => {
      const id = bracketId || bareId;
      return renderAnchor(id) || m;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

function renderTable(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers
    .map((header) => `<th scope="col">${inline(header)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((row) => {
      const anchorId = headers[0] === '锚点' && anchorMap.has(row[0]) ? ` id="anchor-${esc(row[0])}"` : '';
      return `<tr${anchorId}>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`;
    })
    .join('')}</tbody></table></div>`;
}

/**
 * 渲染受控 Markdown 子集，并同时收集标题目录。
 * rootNavId 用于让一个文档的一级标题链接到外层卡片，而不是被重复标题截断。
 */
function renderMd(md, { idPrefix = 'doc', rootNavId = '', toc = [] } = {}) {
  const lines = md.split('\n');
  const output = [];
  const headingCounts = new Map();
  let i = 0;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
      paragraph = [];
    }
  };

  const headingId = (text, level) => {
    const base = `${idPrefix}-${slugify(text)}`;
    const count = headingCounts.get(base) || 0;
    headingCounts.set(base, count + 1);
    const renderedId = count === 0 ? base : `${base}-${count + 1}`;
    const navigationId = level === 1 && rootNavId ? rootNavId : renderedId;
    toc.push({ level, title: text, id: navigationId });
    return renderedId;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushParagraph();
      const language = line.slice(3).trim();
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      output.push(language === 'mermaid'
        ? `<pre class="mermaid">${esc(code.join('\n'))}</pre>`
        : `<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*<\/?(details|summary)(?:\s|>)/i.test(line)) {
      flushParagraph();
      output.push(line);
      i++;
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|/.test(lines[i + 1])) {
      flushParagraph();
      const headers = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      output.push(renderTable(headers, rows));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const text = heading[2].trim();
      output.push(`<h${level} id="${headingId(text, level)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      output.push('<hr>');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      i++;
      continue;
    }

    const listItem = /^\s*([-*+]|\d+\.)\s+/.exec(line);
    if (listItem) {
      flushParagraph();
      const ordered = /\d+\./.test(listItem[1]);
      const items = [];
      while (i < lines.length) {
        const current = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(lines[i]);
        if (!current || (/\d+\./.test(current[1]) !== ordered)) break;
        items.push(`<li>${inline(current[2])}</li>`);
        i++;
      }
      output.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph();
  return output.join('\n');
}

function renderNavItems(entries) {
  if (!entries.length) return '<div class="nav-empty">暂无内容</div>';
  return `<ul class="nav-list">${entries.map((entry) =>
    `<li class="nav-item nav-level-${Math.min(entry.level, 4)}"><a href="#${esc(entry.id)}">${inline(entry.title)}</a></li>`,
  ).join('')}</ul>`;
}

function renderStepNav(step, entries, reviewFiles = [], interfaceFiles = [], codeFiles = []) {
  const first = entries[0];
  const rest = entries.slice(1);
  return `<details class="nav-group" open><summary><span class="nav-step-id">${esc(step.id)}</span>${inline(step.name)}</summary>${
    first ? `<a class="nav-step-title" href="#${esc(step.id)}">${inline(first.title)}</a>` : ''
  }${reviewFiles.length ? `<a class="nav-review-link" href="#review-${esc(step.id)}">代码 Review（${reviewFiles.length}）↗</a>` : ''}${interfaceFiles.length ? `<a class="nav-api-link" href="#interface-entry">接口对接（${interfaceFiles.length}）↗</a>` : ''}${codeFiles.length ? `<a class="nav-code-link" href="#code-entry">代码理解（${codeFiles.length}）↗</a>` : ''}${renderNavItems(rest)}</details>`;
}

/* ---------- 各文档渲染与目录 ---------- */
const overviewToc = [];
const overviewHtml = renderMd(indexMd, { idPrefix: 'overview', rootNavId: 'overview', toc: overviewToc });

const anchorsToc = [];
const anchorsHtml = existsSync(anchorsPath)
  ? renderMd(read(anchorsPath), { idPrefix: 'anchors', rootNavId: 'anchors', toc: anchorsToc })
  : '<p class="empty-state">暂无需求锚点。</p>';

const renderedSteps = steps.map((step) => {
  const toc = [];
  const html = renderMd(read(join(dir, step.file)), {
    idPrefix: step.id,
    rootNavId: step.id,
    toc,
  });
  return { ...step, html, toc };
});

/* ---------- 讨论点聚合视图 ---------- */
const pendingRows = discussions.filter((discussion) =>
  PENDING.includes(discussion.row[discussion.headers.indexOf('状态')]),
);
const settledRows = discussions.filter((discussion) =>
  !PENDING.includes(discussion.row[discussion.headers.indexOf('状态')]),
);

function discussionTable(list) {
  if (!list.length) return '<p class="empty-state">暂无。</p>';
  const groups = new Map();
  for (const discussion of list) {
    const key = discussion.headers.join('|');
    const group = groups.get(key) || { headers: discussion.headers, rows: [] };
    group.rows.push(discussion);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const headers = ['步骤', ...group.headers];
    return `<div class="table-wrap"><table class="discussion-table"><thead><tr>${headers
      .map((header) => `<th scope="col">${inline(header)}</th>`)
      .join('')}</tr></thead><tbody>${group.rows.map((discussion) => {
        const id = discussion.row[0];
        const changedClass = recentDiscussionIds.has(id) ? ' class="changed"' : '';
        return `<tr${changedClass}><td><a href="#${esc(discussion.step)}">${esc(discussion.step)}</a></td>${discussion.row
          .map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
  }).join('');
}

/* ---------- Review 区：挂载到对应步骤 ---------- */
const reviewDir = join(dir, 'review');
const reviewByStep = new Map();
if (existsSync(reviewDir)) {
  for (const file of readdirSync(reviewDir).sort()) {
    const step = steps.find((item) => file.startsWith(`${item.id}-`));
    if (!step || !file.endsWith('.md')) continue;
    const entries = reviewByStep.get(step.id) || [];
    entries.push(file);
    reviewByStep.set(step.id, entries);
  }
}

function renderReviewFile(file) {
  const entryId = `review-${slugify(file)}`;
  const path = join(reviewDir, file);
  return `<div class="review-doc" id="${esc(entryId)}">${renderMd(read(path), { idPrefix: `${entryId}-doc` })}</div>`;
}

/* ---------- 接口对接地图 ---------- */
const interfaceReviews = [];
const interfaceChanges = [];
const interfaceFilesByStep = new Map();
for (const [stepId, files] of reviewByStep.entries()) {
  for (const file of files) {
    const content = read(join(reviewDir, file));
    const section = content.split(/^##\s+接口变更清单\s*$/m)[1]?.split(/^##\s+/m)[0] || '';
    if (!section) continue;
    interfaceReviews.push({ stepId, file });
    const stepFiles = interfaceFilesByStep.get(stepId) || [];
    stepFiles.push(file);
    interfaceFilesByStep.set(stepId, stepFiles);
    for (const table of parseTables(section, ['类型'])) {
      const typeIndex = table.headers.indexOf('类型');
      const pathIndex = table.headers.findIndex((header) => /请求方法\/路径|方法\/路径\/事件|接口名称|接口/.test(header));
      const fieldIndex = table.headers.findIndex((header) => /字段/.test(header));
      const actionIndex = table.headers.findIndex((header) => /前端动作/.test(header));
      for (const row of table.rows) {
        const type = row[typeIndex] || '';
        if (!/(?:新增|修改|删除|废弃|复用)/.test(type)) continue;
        interfaceChanges.push({
          stepId,
          file,
          type,
          path: pathIndex >= 0 ? row[pathIndex] || '' : '',
          fields: fieldIndex >= 0 ? row[fieldIndex] || '' : '',
          action: actionIndex >= 0 ? row[actionIndex] || '' : '',
        });
      }
    }
  }
}

function renderInterfaceOverview() {
  if (!interfaceReviews.length) return '';
  const count = (pattern) => interfaceChanges.filter((item) => pattern.test(item.type)).length;
  const rows = interfaceChanges.map((item) => `<tr>
    <td><a href="#${esc(`review-${slugify(item.file)}`)}">${esc(item.stepId)}</a></td>
    <td>${inline(item.type)}</td>
    <td>${inline(item.path || '未填写')}</td>
    <td>${inline(item.fields || '无字段变化')}</td>
    <td>${inline(item.action || '未填写')}</td>
  </tr>`).join('');
  return `<section class="interface-entry-card" id="interface-entry">
    <div class="section-kicker">前端对接</div>
    <h2>接口对接地图</h2>
    <p class="section-description">这里只展示新增、修改、删除/废弃接口，以及需求涉及但保持原契约的复用接口；普通查询接口不单独列入。</p>
    <div class="interface-counts">
      <span class="interface-count api-add">新增 ${count(/新增/)}</span>
      <span class="interface-count api-change">修改 ${count(/修改/)}</span>
      <span class="interface-count api-delete">删除/废弃 ${count(/删除|废弃/)}</span>
      <span class="interface-count api-reuse">复用 ${count(/复用/)}</span>
    </div>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>步骤</th><th>类型</th><th>请求方法/路径</th><th>字段变化</th><th>前端动作</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-state">已完成批次均明确无接口变化。</p>'}
  </section>`;
}

const codeReviews = [];
const codeEntries = [];
const codeFilesByStep = new Map();
for (const [stepId, files] of reviewByStep.entries()) {
  for (const file of files) {
    const content = read(join(reviewDir, file));
    const section = content.split(/^##\s+代码结构与调用清单\s*$/m)[1]?.split(/^##\s+/m)[0] || '';
    if (!section) continue;
    codeReviews.push({ stepId, file });
    const stepFiles = codeFilesByStep.get(stepId) || [];
    stepFiles.push(file);
    codeFilesByStep.set(stepId, stepFiles);
    for (const table of parseTables(section, ['页面/组件/函数'])) {
      const typeIndex = table.headers.indexOf('类型');
      const targetIndex = table.headers.indexOf('页面/组件/函数');
      const callIndex = table.headers.findIndex((header) => /调用入口|调用方/.test(header));
      const paramsIndex = table.headers.findIndex((header) => /Props\/参数\/返回值|参数\/返回值/.test(header));
      const sideEffectsIndex = table.headers.findIndex((header) => /副作用|边界/.test(header));
      for (const row of table.rows) {
        codeEntries.push({
          stepId,
          file,
          type: typeIndex >= 0 ? row[typeIndex] || '' : '',
          target: row[targetIndex] || '',
          call: callIndex >= 0 ? row[callIndex] || '' : '',
          params: paramsIndex >= 0 ? row[paramsIndex] || '' : '',
          sideEffects: sideEffectsIndex >= 0 ? row[sideEffectsIndex] || '' : '',
        });
      }
    }
  }
}

function renderCodeOverview() {
  if (!codeReviews.length) return '';
  const rows = codeEntries.map((item) => `<tr>
    <td><a href="#${esc(`review-${slugify(item.file)}`)}">${esc(item.stepId)}</a></td>
    <td>${inline(item.type || '涉及')}</td>
    <td>${inline(item.target || '未填写')}</td>
    <td>${inline(item.call || '未填写')}</td>
    <td>${inline(item.params || '未填写')}</td>
    <td>${inline(item.sideEffects || '未填写')}</td>
  </tr>`).join('');
  return `<section class="code-entry-card" id="code-entry">
    <div class="section-kicker">个人理解</div>
    <h2>代码理解地图</h2>
    <p class="section-description">先确认页面/组件/函数的职责和调用链，再进入具体实现；这是理解材料，不额外生成对外使用手册。</p>
    <div class="interface-counts"><span class="interface-count code-total">涉及页面/组件/函数 ${codeEntries.length}</span><span class="interface-count code-review-total">已完成批次 ${codeReviews.length}</span></div>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>步骤</th><th>类型</th><th>页面/组件/函数</th><th>调用入口/时机</th><th>Props/参数/返回值</th><th>状态/副作用/边界</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-state">已完成批次均明确无代码结构变更。</p>'}
  </section>`;
}

function renderStepReview(stepId) {
  const files = reviewByStep.get(stepId) || [];
  if (!files.length) return '';
  return `<section class="step-review" id="review-${esc(stepId)}">
    <div class="section-kicker">${esc(stepId)} · 实施批次审查</div>
    <h3>代码 Review</h3>
    <p class="section-description">先看 UML 组件脉络图、接口对接清单和代码理解清单，再进入文件细节。</p>
    ${files.map(renderReviewFile).join('\n')}
  </section>`;
}

const reviewStepEntries = [...reviewByStep.entries()];
const reviewOverviewHtml = reviewStepEntries.length
  ? `<section class="review-entry-card" id="review-entry">
      <div class="section-kicker">全局导航</div>
      <h2>Review 地图</h2>
      <p class="section-description">Review 已挂载到对应步骤；先从这里选择步骤，再按接口对接、代码理解和文件细节深入查看。</p>
      <div class="review-entry-grid">${reviewStepEntries.map(([stepId, files]) =>
        `<a class="review-entry-item" href="#review-${esc(stepId)}"><span class="review-entry-kind">${esc(stepId)}</span><span>${files.length} 份审查材料</span><span class="review-entry-arrow">↗</span></a>`,
      ).join('')}</div>
    </section>`
  : '';

const overviewNav = renderNavItems(overviewToc);
const reviewNav = reviewStepEntries.length
  ? `<div class="nav-caption">Review 导航</div><a class="nav-step-title" href="#review-entry">Review 地图 ↗</a>${interfaceReviews.length ? '<a class="nav-step-title nav-api-link" href="#interface-entry">接口对接地图 ↗</a>' : ''}${codeReviews.length ? '<a class="nav-step-title nav-code-link" href="#code-entry">代码理解地图 ↗</a>' : ''}`
  : '';
const anchorNav = anchorsToc.length
  ? `<details class="nav-group" open><summary>需求锚点</summary>${renderNavItems(anchorsToc)}</details>`
  : '';
const stepNav = renderedSteps.map((step) => renderStepNav(step, step.toc, reviewByStep.get(step.id) || [], interfaceFilesByStep.get(step.id) || [], codeFilesByStep.get(step.id) || [])).join('');
const title = basenameSafe(dir);
const active = existsSync(activePath) ? (() => {
  try { return JSON.parse(read(activePath)); } catch { return {}; }
})() : {};
const docVersion = Number.isFinite(Number(active['文档版本'])) ? Number(active['文档版本']) : null;
const buildTime = new Date().toLocaleString('zh-CN', { hour12: false });

const body = `
<div class="app-shell">
  <aside class="sidebar" aria-label="计划目录">
    <div class="sidebar-header">
      <div class="brand-mark">⌁</div>
      <div>
        <div class="brand-title">计划视图 <span class="doc-version" title="AI 写回计划源文件次数（仅 index/steps/anchors 修改时自增；单纯 build 不增加）">v${docVersion ?? '?'}</span></div>
        <div class="brand-subtitle">${esc(title)}</div>
      </div>
    </div>
    <div class="sidebar-scroll">
      <div class="nav-caption">计划总览</div>
      ${overviewNav}
      ${reviewNav}
      ${anchorNav}
      <div class="nav-caption nav-caption-steps">步骤详情</div>
      ${stepNav}
    </div>
    <div class="sidebar-footer">使用浏览器刷新 · AI 写回后重建</div>
  </aside>

  <main class="main-content">
    <header class="page-header">
      <div>
        <div class="eyebrow">规划与审阅工作台</div>
        <h1>${esc(title)}</h1>
        <div class="header-meta">
          <span class="status-pill">${esc(active['mode'] === 'active' ? '计划模式已开启' : '计划视图')}</span>
          <span>当前步骤：${esc(active['当前步骤'] || '未指定')}</span>
          <span>最近更新：${esc(active['更新时间'] || '以计划索引为准')}</span>
        </div>
      </div>
      <div class="build-note">本页构建于 ${esc(buildTime)}<br><small>需要更新时使用浏览器刷新</small></div>
    </header>

    <article class="document-card overview-card" id="overview">
      ${overviewHtml}
    </article>

    ${reviewOverviewHtml}

    ${renderInterfaceOverview()}

    ${renderCodeOverview()}

    <section class="summary-card" id="discussion-summary">
      <div class="section-kicker">Review 入口</div>
      <h2>待讨论点聚合</h2>
      <p class="section-description">先看未决事项，再按步骤进入上下文。黄色标记表示本轮最近变更。</p>
      <h3>未决 <span class="count-badge">${pendingRows.length}</span></h3>
      ${discussionTable(pendingRows)}
      <details class="settled-block">
        <summary>已确定 / 已下分 <span class="count-badge muted-badge">${settledRows.length}</span></summary>
        ${discussionTable(settledRows)}
      </details>
    </section>

    <article class="document-card anchors-card" id="anchors">
      ${anchorsHtml}
    </article>

    <section class="steps-section" id="step-details">
      <div class="section-kicker">执行与审阅</div>
      <h2>步骤详情</h2>
      <div class="step-stack">
        ${renderedSteps.map((step) => `<article class="step-card" id="${esc(step.id)}">${step.html}${renderStepReview(step.id)}</article>`).join('\n')}
      </div>
    </section>

  </main>


  <div class="anchor-popup" id="anchor-popup" role="dialog" aria-modal="true" aria-label="需求锚点详情" style="display:none">
    <div class="anchor-popup-card">
      <div class="anchor-popup-header">
        <div class="anchor-popup-title">锚点 <span id="anchor-popup-id"></span></div>
        <button class="anchor-popup-close" id="anchor-popup-close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="anchor-popup-body" id="anchor-popup-body"></div>
      <div class="anchor-popup-footer">
        <a href="#anchors" id="anchor-popup-link">定位到锚点原文 ↗</a>
      </div>
    </div>
  </div>
</div>
`;

function basenameSafe(path) {
  return path.replace(/\/+$/, '').split('/').pop();
}

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 计划视图</title>
<style>
:root{
  color-scheme:light;
  --canvas:#f5f5f7;
  --surface:#ffffff;
  --surface-soft:#fbfbfd;
  --ink:#1d1d1f;
  --ink-secondary:#6e6e73;
  --line:#e5e5ea;
  --line-strong:#d2d2d7;
  --blue:#0071e3;
  --blue-soft:#eaf3ff;
  --yellow:#fff7d6;
  --yellow-line:#f0c36a;
  --shadow:0 8px 30px rgba(0,0,0,.045);
  --radius:16px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--canvas)}
body{margin:0;color:var(--ink);background:var(--canvas);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.app-shell{display:grid;grid-template-columns:292px minmax(0,1fr);min-height:100vh}
.sidebar{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:rgba(250,250,252,.92);border-right:1px solid var(--line);backdrop-filter:saturate(180%) blur(20px);z-index:2}
.sidebar-header{display:flex;gap:11px;align-items:center;padding:24px 21px 17px;border-bottom:1px solid rgba(229,229,234,.75)}
.brand-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--ink);color:#fff;font-size:22px;line-height:1;transform:rotate(-12deg)}
.brand-title{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:700;letter-spacing:.01em}.doc-version{display:inline-flex;align-items:center;padding:1px 5px;border-radius:5px;background:var(--blue-soft);color:var(--blue);font-size:10px;font-weight:700;line-height:1.35;cursor:help}.brand-subtitle{max-width:218px;margin-top:2px;color:var(--ink-secondary);font-size:11px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sidebar-scroll{flex:1;overflow:auto;padding:17px 12px 18px}.sidebar-footer{padding:11px 21px;color:var(--ink-secondary);font-size:11px;border-top:1px solid rgba(229,229,234,.75)}
.anchor-tag{display:inline-flex;align-items:center;vertical-align:middle;margin:0 1px;padding:1px 5px;border:1px solid var(--line-strong);border-radius:6px;background:#f2f2f5;color:#2d64b3;font-size:.85em;font-weight:650;font-family:inherit;line-height:1.4;white-space:nowrap;cursor:pointer}.anchor-tag:hover{background:var(--blue-soft);border-color:#9cc5f2;color:var(--blue)}
.anchor-popup{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.18);backdrop-filter:blur(2px)}.anchor-popup-card{width:min(520px,calc(100vw - 36px));max-height:min(70vh,calc(100vh - 80px));display:flex;flex-direction:column;background:var(--surface);border:1px solid rgba(210,210,215,.9);border-radius:var(--radius);box-shadow:0 24px 70px rgba(0,0,0,.22)}.anchor-popup-header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px 12px;border-bottom:1px solid var(--line)}.anchor-popup-title{font-size:15px;font-weight:700;color:var(--ink)}.anchor-popup-close{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--ink-secondary);font-size:20px;line-height:1;cursor:pointer}.anchor-popup-close:hover{background:#f0f0f2;color:var(--ink)}.anchor-popup-body{overflow:auto;padding:16px 18px;font-size:14px}.anchor-popup-body .field{margin-bottom:13px}.anchor-popup-body .field-label{display:block;margin-bottom:4px;color:var(--ink-secondary);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}.anchor-popup-body .field-value{line-height:1.6}.anchor-popup-footer{padding:12px 18px 14px;border-top:1px solid var(--line);text-align:right}.anchor-popup-footer a{font-size:13px}
.nav-caption{padding:0 10px 7px;color:var(--ink-secondary);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.nav-caption-steps{margin-top:22px}
.nav-list{list-style:none;margin:0 0 10px;padding:0}.nav-item{margin:1px 0}.nav-item a,.nav-step-title{display:block;padding:4px 10px;border-radius:8px;color:#424245;font-size:12px;line-height:1.45}.nav-item a:hover,.nav-step-title:hover{background:#ededf0;color:var(--ink);text-decoration:none}.nav-level-1 a{font-weight:700;color:#2d2d30}.nav-level-2 a{padding-left:22px}.nav-level-3 a{padding-left:34px;color:var(--ink-secondary)}.nav-level-4 a{padding-left:46px;color:var(--ink-secondary)}
.nav-group{margin:3px 0}.nav-group summary{display:flex;gap:7px;align-items:flex-start;padding:6px 10px;border-radius:8px;cursor:pointer;color:#2d2d30;font-size:12px;font-weight:650;line-height:1.45;list-style:none}.nav-group summary::-webkit-details-marker{display:none}.nav-group summary::before{content:'⌄';width:12px;color:var(--ink-secondary);font-size:13px;line-height:1.35}.nav-group:not([open]) summary::before{content:'›'}.nav-group summary:hover{background:#ededf0}.nav-step-id{flex:none;color:var(--blue);font-variant-numeric:tabular-nums}.nav-step-title{margin:2px 0 2px 19px;color:var(--blue);font-weight:650}.nav-review-link{display:block;margin:2px 0 2px 19px;padding:3px 10px;border-radius:7px;color:#7b4bb7;font-size:11px;font-weight:650}.nav-review-link:hover{background:#f4effb;color:#63339e;text-decoration:none}.nav-api-link{display:block;margin:2px 0 2px 19px;padding:3px 10px;border-radius:7px;color:#0b7a65;font-size:11px;font-weight:650}.nav-api-link:hover{background:#edf9f5;color:#05634f;text-decoration:none}.nav-group>.nav-list{margin-left:19px}.nav-empty{padding:5px 10px;color:var(--ink-secondary);font-size:12px}
.main-content{min-width:0;padding:38px clamp(22px,4vw,64px) 64px}.page-header{display:flex;justify-content:space-between;gap:28px;max-width:1320px;margin:0 auto 25px;padding:4px 4px 0}.eyebrow,.section-kicker{color:var(--blue);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.page-header h1{max-width:820px;margin:6px 0 12px;font-size:clamp(25px,3vw,38px);line-height:1.22;letter-spacing:-.035em}.header-meta{display:flex;flex-wrap:wrap;gap:8px 16px;color:var(--ink-secondary);font-size:12px}.status-pill,.count-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;background:var(--blue-soft);color:var(--blue);font-size:11px;font-weight:700}.build-note{flex:none;padding-top:22px;color:var(--ink-secondary);font-size:12px;text-align:right;line-height:1.5}.build-note small{font-size:11px}
.document-card,.summary-card,.step-card,.review-section{max-width:1320px;margin:0 auto 24px;padding:30px 34px;background:var(--surface);border:1px solid rgba(210,210,215,.72);border-radius:var(--radius);box-shadow:var(--shadow)}.overview-card{padding-top:25px}.anchors-card{background:var(--surface-soft)}
.review-entry-card,.interface-entry-card,.code-entry-card{max-width:1320px;margin:0 auto 24px;padding:25px 34px;background:linear-gradient(180deg,#f7fbff 0%,#fff 100%);border:1px solid #cfe2f8;border-radius:var(--radius);box-shadow:var(--shadow)}.interface-entry-card{background:linear-gradient(180deg,#f4fcfa 0%,#fff 100%);border-color:#c8e8df}.code-entry-card{background:linear-gradient(180deg,#faf7ff 0%,#fff 100%);border-color:#dfd2f3}.code-entry-card h2{margin:5px 0 4px;font-size:25px;line-height:1.3;letter-spacing:-.025em}.interface-entry-card h2{margin:5px 0 4px;font-size:25px;line-height:1.3;letter-spacing:-.025em}.interface-counts{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}.interface-count{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700}.api-add{background:#eaf7ef;color:#16733d}.api-change{background:#fff5dc;color:#9a6400}.api-delete{background:#fff0f0;color:#b33b3b}.api-reuse{background:#eaf3ff;color:#2d64b3}.review-entry-card h2{margin:5px 0 4px;font-size:25px;line-height:1.3;letter-spacing:-.025em}.review-entry-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:9px;margin-top:17px}.review-entry-item{display:flex;align-items:center;gap:9px;padding:11px 13px;border:1px solid #dfe9f7;border-radius:10px;background:rgba(255,255,255,.82);color:var(--ink);font-size:13px}.review-entry-item:hover{border-color:#9cc5f2;background:#fff;text-decoration:none}.review-entry-kind{flex:none;padding:2px 6px;border-radius:5px;background:var(--blue-soft);color:var(--blue);font-size:10px;font-weight:700}.review-entry-arrow{margin-left:auto;color:var(--blue)}.summary-card{background:linear-gradient(180deg,#fff 0%,#fbfcff 100%);border-color:#dfe9f7}.step-review{margin-top:34px;padding-top:25px;border-top:2px solid #dfe9f7}.step-review>h3{margin:5px 0 4px;font-size:22px}.step-review .section-description{margin-bottom:17px}.review-doc{padding:18px 20px;border:1px solid #e4edf8;border-radius:12px;background:#fbfdff}.review-doc+.review-doc{margin-top:14px}.review-doc h1{margin-top:0}.summary-card h2,.steps-section>h2,.review-section h2{margin:5px 0 4px;font-size:25px;line-height:1.3;letter-spacing:-.025em}.section-description{margin:0 0 21px;color:var(--ink-secondary);font-size:13px}.summary-card h3{margin:22px 0 7px;font-size:16px}.muted-badge{background:#f0f0f2;color:var(--ink-secondary)}.settled-block{margin-top:20px;border-top:1px solid var(--line);padding-top:13px}.settled-block summary{cursor:pointer;color:#424245;font-size:13px;font-weight:650}.steps-section,.review-section{max-width:1320px;margin:0 auto}.steps-section>h2,.review-section h2{margin-bottom:17px}.step-stack{display:grid;gap:18px}.step-card{margin:0;padding:31px 34px;scroll-margin-top:20px}.review-section{padding:30px 34px}
.document-card h1,.step-card h1{margin:0 0 23px;padding-bottom:13px;border-bottom:1px solid var(--line);font-size:27px;line-height:1.3;letter-spacing:-.025em}.document-card h2,.step-card h2{margin:31px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line);font-size:21px;line-height:1.4;letter-spacing:-.018em}.document-card h3,.step-card h3{margin:24px 0 7px;font-size:17px;line-height:1.45}.document-card h4,.step-card h4{margin:18px 0 5px;font-size:15px}.document-card p,.step-card p,.review-section p{margin:9px 0}.document-card ul,.document-card ol,.step-card ul,.step-card ol,.review-section ul,.review-section ol{margin:8px 0 13px;padding-left:24px}.document-card li,.step-card li,.review-section li{margin:3px 0}.document-card blockquote,.step-card blockquote{margin:14px 0;padding:10px 15px;border-left:3px solid #b9d6f7;background:var(--blue-soft);color:#3f4f62;border-radius:0 9px 9px 0}.document-card hr,.step-card hr{margin:25px 0;border:0;border-top:1px solid var(--line)}
.table-wrap{width:100%;overflow-x:auto;margin:12px 0 17px;border:1px solid var(--line);border-radius:10px}.table-wrap table{width:100%;min-width:620px;border-collapse:collapse;font-size:13px;line-height:1.55}.table-wrap th,.table-wrap td{padding:9px 11px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}.table-wrap th:last-child,.table-wrap td:last-child{border-right:0}.table-wrap tr:last-child td{border-bottom:0}.table-wrap th{background:#f7f7f9;color:#424245;font-weight:700}.table-wrap tr[id]{scroll-margin-top:24px}.table-wrap tr[id]:target td{background:var(--yellow)!important}.table-wrap tbody tr:nth-child(even){background:#fcfcfd}.discussion-table tr.changed td{background:var(--yellow);border-bottom-color:#f4df9f}.discussion-table tr.changed td:first-child{box-shadow:inset 3px 0 0 var(--yellow-line)}
code{padding:2px 5px;border-radius:5px;background:#f1f1f4;color:#b34700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;overflow-wrap:anywhere}pre{margin:15px 0;padding:15px 17px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:#f7f7f9;color:#242426;font-size:13px;line-height:1.55}pre code{padding:0;background:transparent;color:inherit}.mermaid{display:flex;justify-content:center;min-height:40px;background:#fbfbfd}.document-card img,.step-card img{max-width:100%;height:auto;border-radius:10px}.empty-state{color:var(--ink-secondary)}
details{margin:13px 0;border:1px solid var(--line);border-radius:11px;background:var(--surface-soft);overflow:hidden}details>summary{padding:10px 13px;cursor:pointer;color:#424245;font-weight:650;list-style:none}details>summary::-webkit-details-marker{display:none}details>summary::before{content:'›';display:inline-block;width:17px;color:var(--ink-secondary);font-size:17px;line-height:1;vertical-align:-1px}details[open]>summary::before{content:'⌄'}details>summary:hover{background:#f1f1f4}details>p,details>ul,details>ol,details>table,details>.table-wrap,details>pre,details>h2,details>h3,details>h4,details>blockquote{margin-left:14px;margin-right:14px}
@media(max-width:980px){.app-shell{grid-template-columns:245px minmax(0,1fr)}.main-content{padding-left:20px;padding-right:20px}.document-card,.summary-card,.step-card,.review-section,.review-entry-card,.interface-entry-card,.code-entry-card{padding-left:23px;padding-right:23px}.page-header{display:block}.build-note{padding-top:10px;text-align:left}}
@media(max-width:720px){.app-shell{display:block}.sidebar{position:relative;height:auto;max-height:47vh;border-right:0;border-bottom:1px solid var(--line)}.sidebar-scroll{max-height:32vh}.main-content{padding:22px 12px 64px}.page-header{padding:0 6px}.page-header h1{font-size:27px}.document-card,.summary-card,.step-card,.review-section,.review-entry-card,.interface-entry-card,.code-entry-card{padding:22px 17px;border-radius:13px}.document-card h1,.step-card h1{font-size:23px}.document-card h2,.step-card h2{font-size:19px}}
</style>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({startOnLoad:true, securityLevel:'loose', theme:'base', themeVariables:{primaryColor:'#eaf3ff',primaryTextColor:'#1d1d1f',primaryBorderColor:'#9cc5f2',lineColor:'#6e6e73'}});
</script>
<script>
document.addEventListener('DOMContentLoaded', () => {
  (() => {
  const anchorData = ${JSON.stringify(Object.fromEntries(anchorMap), null, 2)};
  const popup = document.getElementById('anchor-popup');
  const popupId = document.getElementById('anchor-popup-id');
  const popupBody = document.getElementById('anchor-popup-body');
  const popupClose = document.getElementById('anchor-popup-close');
  const popupLink = document.getElementById('anchor-popup-link');
  const htmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const showPopup = (id) => {
    const data = anchorData[id];
    if (!data) return;
    popupId.textContent = id;
    popupLink.href = '#anchor-' + id;
    popupBody.innerHTML = Object.entries(data)
      .filter(([key]) => key !== '锚点')
      .map(([key, value]) => {
        const label = htmlEscape(key);
        const body = htmlEscape(value).replace(/\\n/g, '<br>');
        return '<div class="field"><span class="field-label">' + label + '</span><div class="field-value">' + body + '</div></div>';
      })
      .join('');
    popup.style.display = 'flex';
    popupClose.focus();
  };
  const hidePopup = () => { popup.style.display = 'none'; };
  document.body.addEventListener('click', (event) => {
    const tag = event.target.closest('.anchor-tag');
    if (tag) { event.preventDefault(); showPopup(tag.dataset.anchor); return; }
    if (event.target === popup) hidePopup();
  });
  popupClose.addEventListener('click', hidePopup);
  popupLink.addEventListener('click', hidePopup);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && popup.style.display !== 'none') hidePopup(); });
  })();
});
</script>
</head><body>${body}</body></html>`;

const outputDir = join(dir, 'build');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'plan.html'), html);
console.log(`✅ 已生成 ${join(outputDir, 'plan.html')}（步骤 ${steps.length}，讨论点 ${discussions.length}，未决 ${pendingRows.length}）`);
