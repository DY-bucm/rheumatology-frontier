import fs from "node:fs/promises";

const required = [
  "index.html",
  "detail.html",
  "assets/app.js",
  "assets/detail.js",
  "assets/shared.js",
  "assets/styles.css",
  "data/items.json",
  "data/diseases.json",
  "data/source-config.json",
  "data/exclusion-rules.json",
  "scripts/update-feed.mjs",
  "scripts/enrich-ai.mjs",
  "scripts/build-quality-report.mjs",
  ".github/workflows/daily-update.yml"
];

const errors = [];
for (const file of required) {
  try {
    await fs.access(file);
  } catch {
    errors.push(`缺少文件: ${file}`);
  }
}

for (const file of ["data/items.json", "data/diseases.json", "data/source-config.json", "data/exclusion-rules.json"]) {
  try {
    JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    errors.push(`${file} 不是有效 JSON: ${error.message}`);
  }
}

const indexHtml = await fs.readFile("index.html", "utf8");
if (!indexHtml.includes("每日一看，科研小站")) {
  errors.push("站点标题尚未更新");
}
if (indexHtml.includes("覆盖 12 个核心病种模块")) {
  errors.push("首页仍包含已要求删除的主视觉说明文字");
}
if (indexHtml.includes("证据标注方法") || indexHtml.includes('id="method"')) {
  errors.push("首页仍包含已要求删除的方法说明模块");
}
for (const hiddenLabel of ["先看研究阶段", "证据等级", "结论强度", "可信度", "误读风险"]) {
  if (indexHtml.includes(hiddenLabel)) errors.push(`首页仍包含不应展示的字段: ${hiddenLabel}`);
}
if (!indexHtml.includes('data-window="1"') || !indexHtml.includes('data-window="5"')) {
  errors.push("首页缺少最新1天/近5天切换");
}
if (!indexHtml.includes('id="source-status"')) {
  errors.push("首页缺少数据来源状态模块");
}

const workflow = await fs.readFile(".github/workflows/daily-update.yml", "utf8");
for (const requiredText of [
  "--days 5",
  "--retentionDays 5",
  "DEEPSEEK_API_KEY",
  'TRANSLATION_LIMIT: "500"',
  'TRANSLATION_ATTEMPTS: "3"',
  "build-quality-report.mjs"
]) {
  if (!workflow.includes(requiredText)) errors.push(`工作流缺少配置: ${requiredText}`);
}

const sourceConfig = JSON.parse(await fs.readFile("data/source-config.json", "utf8"));
if (sourceConfig.pubmed?.enabled !== true) errors.push("PubMed 数据源未启用");
if (sourceConfig.clinicalTrials?.enabled !== false) errors.push("ClinicalTrials.gov 应保持关闭");

const allText = await Promise.all(
  (await walk("."))
    .filter(file => /\.(html|js|json|md|yml)$/.test(file))
    .map(file => fs.readFile(file, "utf8"))
);
const frontendText = await Promise.all(
  ["index.html", "detail.html", "assets/app.js", "assets/detail.js", "assets/shared.js"]
    .map(file => fs.readFile(file, "utf8"))
);
for (const hiddenLabel of [
  "待人工",
  "人工复核",
  "人工审核",
  "需人工",
  "证据等级",
  "结论强度",
  "可信度",
  "误读风险",
  "研究阶段",
  "自动初筛"
]) {
  if (frontendText.some(text => text.includes(hiddenLabel))) {
    errors.push(`前台仍包含不应展示的内容: ${hiddenLabel}`);
  }
}
for (const legacy of ["amyotrophic lateral sclerosis", "TDP-43", "C9orf72"]) {
  if (allText.some(text => text.toLowerCase().includes(legacy.toLowerCase()))) {
    errors.push(`发现未清理的 ALS 术语: ${legacy}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Site verification passed.");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(file));
    else files.push(file);
  }
  return files;
}
