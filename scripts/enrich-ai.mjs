import fs from "node:fs/promises";
import crypto from "node:crypto";

const [input = "data/items.json", output = input] = process.argv.slice(2);
const payload = JSON.parse(await fs.readFile(input, "utf8"));
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const limit = Number(process.env.TRANSLATION_LIMIT || 100);

if (!apiKey) {
  console.log("DEEPSEEK_API_KEY is not configured; skipping translation.");
  process.exit(0);
}

function sourceHash(item) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({
      pmid: item.pmid,
      doi: item.doi,
      title: item.title,
      abstract: item.abstract
    }))
    .digest("hex");
}

function validTranslation(result, item) {
  const basic = result
    && typeof result.titleZh === "string"
    && result.titleZh.trim().length > 0
    && typeof result.abstractZh === "string"
    && (!item.abstract || result.abstractZh.trim().length > 0);
  if (!basic) return { passed: false, reason: "翻译字段不完整" };

  const source = `${item.title || ""} ${item.abstract || ""}`;
  const translated = `${result.titleZh} ${result.abstractZh}`;
  const missingNumbers = protectedNumbers(source).filter(token => !translated.includes(token));
  const missingTerms = protectedTerms(source).filter(token => !translated.toLowerCase().includes(token.toLowerCase()));
  if (missingNumbers.length) {
    return { passed: false, reason: `数字缺失: ${missingNumbers.slice(0, 8).join(", ")}` };
  }
  if (missingTerms.length) {
    return { passed: false, reason: `缩写/标识缺失: ${missingTerms.slice(0, 8).join(", ")}` };
  }
  return { passed: true, reason: "" };
}

function protectedNumbers(text = "") {
  return [...new Set(text.match(/\b\d+(?:\.\d+)?(?:%|×10[-−]?\d+)?\b/g) || [])];
}

function protectedTerms(text = "") {
  const candidates = text.match(/\b(?:[A-Z]{2,}[A-Z0-9-]*|[A-Za-z]{1,6}-\d{1,4}|NCT\d{8})\b/g) || [];
  const generic = new Set(["THE", "AND", "OR", "CI", "SD", "HR", "OR"]);
  return [...new Set(candidates.filter(token => !generic.has(token.toUpperCase())))];
}

async function translate(item) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `你是医学文献翻译器，只做忠实翻译，不做总结、解释、推断或医疗建议。
必须遵守：
1. 不添加英文原文中不存在的信息。
2. 不改变数字、样本量、效应量、P值、置信区间和研究结论强度。
3. 保留药物名、基因名、蛋白名、缩写、PMID、DOI、NCT编号。
4. observational association 不能翻译成因果；动物或细胞结果不能写成患者疗效。
5. 原文没有摘要时，abstractZh 必须为空字符串。
6. 只输出 JSON，不得输出 Markdown。
JSON格式示例：{"titleZh":"忠实中文标题","abstractZh":"忠实中文摘要全文"}`
        },
        {
          role: "user",
          content: JSON.stringify({
            title: item.title || "",
            abstract: item.abstract || "",
            pmid: item.pmid || "",
            doi: item.doi || ""
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  return JSON.parse(content);
}

const candidates = (payload.items || [])
  .filter(item => item.source === "PubMed" && item.pmid && item.title)
  .filter(item => item.translationMeta?.sourceHash !== sourceHash(item) || item.translationMeta?.validationPassed !== true)
  .slice(0, limit);

for (const item of candidates) {
  try {
    const result = await translate(item);
    const validation = validTranslation(result, item);
    if (!validation.passed) throw new Error(validation.reason);
    item.titleZh = result.titleZh.trim();
    item.abstractZh = result.abstractZh.trim();
    item.translationMeta = {
      provider: "DeepSeek",
      model,
      type: "AI-assisted faithful translation",
      sourceHash: sourceHash(item),
      translatedAt: new Date().toISOString(),
      reviewStatus: "unreviewed",
      validationPassed: true,
      validationMethod: "numbers-and-identifiers-preserved"
    };
    console.log(`Translated ${item.id}`);
  } catch (error) {
    item.titleZh = "";
    item.abstractZh = "";
    delete item.translationMeta;
    console.error(`Translation failed for ${item.id}: ${error.message}`);
  }
}

await fs.writeFile(output, JSON.stringify(payload, null, 2) + "\n");
console.log(`Translation step finished for ${candidates.length} candidate(s).`);

