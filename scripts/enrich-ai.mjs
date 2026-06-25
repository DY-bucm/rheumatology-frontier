import fs from "node:fs/promises";

const [input = "data/items.json", output = input] = process.argv.slice(2);
const payload = JSON.parse(await fs.readFile(input, "utf8"));
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = (process.env.AI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-5.2";
const limit = Number(process.env.AI_ENRICH_LIMIT || 20);
if (!apiKey) {
  console.log("No AI_API_KEY or OPENAI_API_KEY; skipping enrichment.");
  process.exit(0);
}

const candidates = payload.items.filter(item => !item.titleZh || !item.summaryZh).slice(0, limit);
for (const item of candidates) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `你是严谨的风湿免疫科研编辑。忠实翻译，不虚构，不提供医疗建议，不夸大临床意义。保留药物、基因、蛋白、疾病亚型、DOI、PMID、NCT。必须区分试验注册与结果、临床前与患者证据、观察性关联与因果。只输出JSON。` },
          { role: "user", content: `请处理以下记录并输出字段：titleZh, abstractZh, summaryZh, insight, evidenceLevel, priority, frontierRationale, aiRead{studyType,keyFinding,limitation,watchNext}, credibility{studyStage,conclusionStrength,clinicalImplication,riskNote,confidence}。\n来源:${item.source}\n标题:${item.title}\n摘要:${item.abstract || "无"}\n已有阶段:${item.credibility?.studyStage || ""}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    Object.assign(item, JSON.parse(content));
    console.log(`Enriched ${item.id}`);
  } catch (error) {
    console.error(`AI enrichment failed for ${item.id}:`, error.message);
  }
}
await fs.writeFile(output, JSON.stringify(payload, null, 2) + "\n");
