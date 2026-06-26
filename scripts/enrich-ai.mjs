import fs from "node:fs/promises";
import crypto from "node:crypto";

const [input = "data/items.json", output = input] = process.argv.slice(2);
const payload = JSON.parse(await fs.readFile(input, "utf8"));
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const limit = Number(process.env.TRANSLATION_LIMIT || 500);
const maxTranslationAttempts = Number(process.env.TRANSLATION_ATTEMPTS || 3);
const concurrency = Math.max(1, Math.min(Number(process.env.TRANSLATION_CONCURRENCY || 3), 5));

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

function protectedNumbers(text = "") {
  const matches = text.match(/\b\d[\d,]*(?:\.\d+)?(?:%|×10[-−]?\d+)?\b/g) || [];
  return [...new Set(matches.map(token => token.replaceAll(",", "")))];
}

function protectedTerms(text = "") {
  const candidates = text.match(/\b(?:[A-Z]{2,}[A-Z0-9-]*|NCT\d{8})\b/g) || [];
  const generic = new Set(["THE", "AND", "OR"]);
  return [...new Set(candidates.filter(token => !generic.has(token.toUpperCase())))];
}

function validateTranslation(result, item) {
  const complete = result
    && typeof result.titleZh === "string"
    && result.titleZh.trim().length > 0
    && typeof result.abstractZh === "string"
    && (!item.abstract || result.abstractZh.trim().length > 0);
  if (!complete) return { passed: false, reason: "翻译字段不完整" };

  const source = `${item.title || ""} ${item.abstract || ""}`;
  const translated = `${result.titleZh} ${result.abstractZh}`;
  const normalizedTranslated = translated.replaceAll(",", "");
  const missingNumbers = protectedNumbers(source).filter(token => !normalizedTranslated.includes(token));
  const missingTerms = protectedTerms(source)
    .filter(token => !translated.toLowerCase().includes(token.toLowerCase()));

  if (missingNumbers.length) {
    return { passed: false, reason: `必须保留这些数字：${missingNumbers.slice(0, 20).join(", ")}` };
  }
  if (missingTerms.length) {
    return { passed: false, reason: `必须保留这些缩写：${missingTerms.slice(0, 20).join(", ")}` };
  }
  return { passed: true, reason: "" };
}

function promptMessages(item, correction = "") {
  return [
    {
      role: "system",
      content: `你是医学文献翻译器，只做忠实翻译，不做总结、解释、推断或医疗建议。
要求：
1. 不添加英文原文中不存在的信息。
2. 不改变数字、样本量、效应量、P值、置信区间和研究结论强度。
3. 原样保留医学缩写、基因名、蛋白名和药物通用名。
4. 观察性关联不能翻译成因果；动物或细胞结果不能写成患者疗效。
5. 英文原文没有摘要时，abstractZh 必须为空字符串。
6. 化学名称可以准确翻译，不要求保留普通英文连字符词。
7. 只输出 JSON，不输出 Markdown。
JSON格式：{"titleZh":"中文标题","abstractZh":"中文摘要全文"}`
    },
    {
      role: "user",
      content: JSON.stringify({
        title: item.title || "",
        abstract: item.abstract || "",
        pmid: item.pmid || "",
        correction
      })
    }
  ];
}

async function requestTranslation(item, correction = "") {
  const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 6000,
      response_format: { type: "json_object" },
      messages: promptMessages(item, correction)
    })
  });
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");
  return JSON.parse(content);
}

async function fetchWithRetry(url, options, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(120_000)
    });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(60_000, 2 ** attempt * 1500);
    console.warn(`DeepSeek returned ${response.status}; retrying in ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  throw new Error("DeepSeek request failed");
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const candidates = (payload.items || [])
  .filter(item => item.source === "PubMed" && item.pmid && item.title)
  .filter(item => item.translationMeta?.sourceHash !== sourceHash(item)
    || item.translationMeta?.validationPassed !== true)
  .sort((a, b) => {
    const aFailures = a.translationFailure?.totalAttempts || 0;
    const bFailures = b.translationFailure?.totalAttempts || 0;
    if (aFailures !== bFailures) return bFailures - aFailures;
    return new Date(b.date) - new Date(a.date);
  })
  .slice(0, limit);

let translatedCount = 0;
let failedCount = 0;

async function processItem(item) {
  let correction = "";
  let success = false;
  let lastError = "";
  for (let attempt = 1; attempt <= maxTranslationAttempts; attempt += 1) {
    try {
      const result = await requestTranslation(item, correction);
      const validation = validateTranslation(result, item);
      if (!validation.passed) {
        lastError = validation.reason;
        correction = `上一次译文未通过校验。${validation.reason}。请重新完整翻译并原样保留这些内容。`;
        continue;
      }
      item.titleZh = result.titleZh.trim();
      item.abstractZh = result.abstractZh.trim();
      item.translationMeta = {
        provider: "DeepSeek",
        model,
        type: "faithful-translation",
        sourceHash: sourceHash(item),
        translatedAt: new Date().toISOString(),
        validationPassed: true,
        validationMethod: "numbers-and-medical-abbreviations-preserved",
        attempts: attempt
      };
      delete item.translationFailure;
      translatedCount += 1;
      success = true;
      console.log(`Translated ${item.id} on attempt ${attempt}`);
      break;
    } catch (error) {
      lastError = error.message;
      correction = `上一次请求失败：${error.message}。请重新输出符合要求的 JSON 译文。`;
      if (attempt === maxTranslationAttempts) {
        console.error(`Translation failed for ${item.id}: ${error.message}`);
      }
    }
  }
  if (!success) {
    item.titleZh = "";
    item.abstractZh = "";
    delete item.translationMeta;
    item.translationFailure = {
      lastAttemptAt: new Date().toISOString(),
      lastReason: lastError || "unknown",
      totalAttempts: (item.translationFailure?.totalAttempts || 0) + maxTranslationAttempts,
      retryPending: true
    };
    failedCount += 1;
  }
}

let cursor = 0;
async function worker() {
  while (cursor < candidates.length) {
    const item = candidates[cursor];
    cursor += 1;
    await processItem(item);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

payload.translationStatus = {
  attemptedAt: new Date().toISOString(),
  candidates: candidates.length,
  translated: translatedCount,
  failed: failedCount,
  publishable: (payload.items || []).filter(item =>
    item.titleZh
    && item.translationMeta?.validationPassed === true
    && (!item.abstract || item.abstractZh)
  ).length,
  pending: (payload.items || []).filter(item =>
    !item.titleZh
    || item.translationMeta?.validationPassed !== true
    || (item.abstract && !item.abstractZh)
  ).length
};

await fs.writeFile(output, JSON.stringify(payload, null, 2) + "\n");
console.log(`Translation finished: ${translatedCount} succeeded, ${failedCount} failed.`);
