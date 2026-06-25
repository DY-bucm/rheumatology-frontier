import fs from "node:fs/promises";

const required = [
  "index.html", "detail.html", "assets/app.js", "assets/detail.js", "assets/shared.js",
  "assets/styles.css", "data/items.json", "data/diseases.json", "data/source-config.json", "data/exclusion-rules.json",
  "scripts/update-feed.mjs", "scripts/enrich-ai.mjs", ".github/workflows/daily-update.yml"
];
const errors = [];
for (const file of required) {
  try { await fs.access(file); } catch { errors.push(`缺少文件: ${file}`); }
}
try {
  const payload = JSON.parse(await fs.readFile("data/items.json", "utf8"));
  for (const item of payload.items || []) {
    for (const key of ["id", "source", "date", "title", "url", "credibility"]) {
      if (!item[key]) errors.push(`${item.id || "未知记录"} 缺少 ${key}`);
    }
    if (!item.diseaseId || !item.diseaseZh) errors.push(`${item.id || "未知记录"} 缺少病种模块`);
    if (item.nctId && item.credibility?.conclusionStrength !== "registered-trial") errors.push(`${item.id} 的试验注册结论强度标记不正确`);
  }
} catch (error) { errors.push(`items.json 无效: ${error.message}`); }
const allText = await Promise.all((await walk(".")).filter(file => /\.(html|js|json|md|yml)$/.test(file)).map(file => fs.readFile(file, "utf8")));
for (const legacy of ["amyotrophic lateral sclerosis", "TDP-43", "C9orf72"]) {
  if (allText.some(text => text.toLowerCase().includes(legacy.toLowerCase()))) errors.push(`发现未清理的 ALS 术语: ${legacy}`);
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
    if (entry.isDirectory()) files.push(...await walk(file)); else files.push(file);
  }
  return files;
}
