import fs from "node:fs/promises";

const [input = "data/items.json", output = "data/quality-report.json"] = process.argv.slice(2);
const payload = JSON.parse(await fs.readFile(input, "utf8"));
const items = payload.items || [];
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const cutoff = new Date(today);
cutoff.setUTCDate(cutoff.getUTCDate() - 4);
const errors = [];
const warnings = [];
const pmids = new Set();

for (const item of items) {
  const label = item.id || item.title || "未知记录";
  if (item.source !== "PubMed") errors.push(`${label}: 来源不是 PubMed`);
  if (!item.pmid || !/^\d+$/.test(item.pmid)) errors.push(`${label}: PMID 缺失或格式错误`);
  if (item.pmid && pmids.has(item.pmid)) errors.push(`${label}: PMID 重复`);
  if (item.pmid) pmids.add(item.pmid);
  if (item.url !== `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`) errors.push(`${label}: PubMed 链接不规范`);
  if (!item.title) errors.push(`${label}: 英文标题缺失`);
  if (!item.date) errors.push(`${label}: PubMed 收录日期缺失`);

  const date = new Date(`${item.date}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) {
    errors.push(`${label}: 日期格式无效`);
  } else {
    if (date > today) errors.push(`${label}: 出现未来日期 ${item.date}`);
    if (date < cutoff) errors.push(`${label}: 超出近5天窗口 ${item.date}`);
  }

  if (!item.diseaseId || !Array.isArray(item.diseaseIds)) warnings.push(`${label}: 病种归类字段不完整`);
  if (item.titleZh && item.translationMeta?.validationPassed !== true) {
    errors.push(`${label}: 中文翻译未通过数字与标识保留校验`);
  }
  if (!item.abstract) warnings.push(`${label}: PubMed 未提供摘要`);
}

const serialized = JSON.stringify(payload);
for (const marker of ["�", "绯荤", "锛", "鈫", "鐮旂"]) {
  if (serialized.includes(marker)) errors.push(`数据中检测到疑似乱码标记: ${marker}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  source: payload.source,
  fetchWindowDays: payload.fetchWindowDays,
  retentionDays: payload.retentionDays,
  total: items.length,
  translated: items.filter(item => item.titleZh && item.translationMeta?.validationPassed).length,
  publishable: items.filter(item =>
    item.titleZh
    && item.translationMeta?.validationPassed === true
    && (!item.abstract || item.abstractZh)
  ).length,
  unpublishedTranslationFailures: items.filter(item =>
    !item.titleZh
    || item.translationMeta?.validationPassed !== true
    || (item.abstract && !item.abstractZh)
  ).length,
  retryPending: items.filter(item => item.translationFailure?.retryPending === true).length,
  withoutAbstract: items.filter(item => !item.abstract).length,
  crossDisease: items.filter(item => (item.diseaseIds || []).length > 1).length,
  errors,
  warnings
};

await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);


