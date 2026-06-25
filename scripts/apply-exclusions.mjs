import fs from "node:fs/promises";

const [input = "data/items.json", rulesFile = "data/exclusion-rules.json", output = input] = process.argv.slice(2);
const payload = JSON.parse(await fs.readFile(input, "utf8"));
const rules = JSON.parse(await fs.readFile(rulesFile, "utf8"));
const excluded = (rules.excludeTitlePatterns || []).map(pattern => new RegExp(pattern, "i"));
const low = (rules.lowRelevancePatterns || []).map(pattern => new RegExp(pattern, "i"));
const context = (rules.requiredContextForLowRelevance || []).map(pattern => new RegExp(pattern, "i"));
const items = (payload.items || payload).filter(item => !excluded.some(regex => regex.test(item.title || ""))).map(item => {
  const text = `${item.title || ""} ${item.abstract || ""}`;
  const relevanceFlag = low.some(regex => regex.test(text)) && !context.some(regex => regex.test(text)) ? "low" : "normal";
  return { ...item, relevanceFlag };
});
await fs.writeFile(output, JSON.stringify({ updatedAt: payload.updatedAt || new Date().toISOString(), items }, null, 2) + "\n");
console.log(`Kept ${items.length} records after exclusions`);
