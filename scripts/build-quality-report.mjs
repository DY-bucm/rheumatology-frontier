import fs from "node:fs/promises";
const payload = JSON.parse(await fs.readFile("data/items.json", "utf8"));
const items = payload.items || [];
const report = {
  generatedAt: new Date().toISOString(),
  total: items.length,
  missingTitleZh: items.filter(item => !item.titleZh).length,
  missingSummaryZh: items.filter(item => !item.summaryZh).length,
  missingSourceUrl: items.filter(item => !item.url).length,
  registeredTrials: items.filter(item => item.credibility?.conclusionStrength === "registered-trial").length,
  preclinical: items.filter(item => item.credibility?.conclusionStrength === "preclinical").length,
  lowRelevance: items.filter(item => item.relevanceFlag === "low").length
};
await fs.writeFile("data/quality-report.json", JSON.stringify(report, null, 2) + "\n");
console.log(report);
