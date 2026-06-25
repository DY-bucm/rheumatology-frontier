import fs from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) {
    const next = values[index + 1];
    pairs.push([value.slice(2), next && !next.startsWith("--") ? next : true]);
  }
  return pairs;
}, []));

const fetchDays = Number(args.days || 5);
const retentionDays = Number(args.retentionDays || 5);
const pageSize = Math.min(Number(args.pageSize || 100), 200);
const maxRecords = Math.min(Number(args.maxRecords || 1000), 5000);
const output = String(args.output || "data/items.json");
const config = JSON.parse(await fs.readFile("data/source-config.json", "utf8"));
const existingPayload = await readJson(output, { items: [] });
const existing = new Map((existingPayload.items || []).map(item => [item.id, item]));
const today = utcDateOnly(new Date());
const ncbiApiKey = process.env.NCBI_API_KEY || "";
const requestIntervalMs = ncbiApiKey ? 350 : 1100;
const fetchCutoff = new Date(`${today}T00:00:00Z`);
fetchCutoff.setUTCDate(fetchCutoff.getUTCDate() - (fetchDays - 1));

function stripTags(value = "") {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value = "") {
  const named = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&apos;": "'", "&#x2013;": "–", "&#x2014;": "—",
    "&#x2009;": " ", "&#xa0;": " "
  };
  return value
    .replace(/&(amp|lt|gt|quot|apos);|&#x(?:2013|2014|2009|a0);/gi, match => named[match.toLowerCase()] || match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function textBetween(xml, tag) {
  return stripTags(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

function allBetween(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map(match => stripTags(match[1]))
    .filter(Boolean);
}

function pubmedEntrezDate(article) {
  const history = article.match(/<History>([\s\S]*?)<\/History>/i)?.[1] || "";
  const block = history.match(/<PubMedPubDate PubStatus="entrez">([\s\S]*?)<\/PubMedPubDate>/i)?.[1]
    || history.match(/<PubMedPubDate PubStatus="pubmed">([\s\S]*?)<\/PubMedPubDate>/i)?.[1]
    || "";
  const year = textBetween(block, "Year");
  const month = textBetween(block, "Month").padStart(2, "0");
  const day = textBetween(block, "Day").padStart(2, "0");
  return year && month && day ? `${year}-${month}-${day}` : today;
}

const diseaseRules = [
  ["pediatric", "儿童风湿病", /juvenile idiopathic arthritis|juvenile systemic lupus|juvenile dermatomyositis|pediatric rheumatic/i],
  ["ra", "类风湿关节炎", /rheumatoid arthritis/i],
  ["sle", "系统性红斑狼疮", /systemic lupus erythematosus|lupus nephritis|neuropsychiatric lupus/i],
  ["sjogren", "干燥综合征", /sj[öo]gren(?:'s)? (?:syndrome|disease)|primary sj[öo]gren/i],
  ["ssc", "系统性硬化症", /systemic sclerosis|systemic scleroderma/i],
  ["myositis", "特发性炎性肌病", /inflammatory myopath|dermatomyositis|polymyositis|necrotizing myopathy|antisynthetase/i],
  ["spa", "脊柱关节炎谱系", /spondyloarthritis|ankylosing spondylitis|psoriatic arthritis/i],
  ["vasculitis", "系统性血管炎", /vasculitis|giant cell arteritis|takayasu|beh[cç]et|granulomatosis with polyangiitis|microscopic polyangiitis|eosinophilic granulomatosis/i],
  ["aps", "抗磷脂综合征", /antiphospholipid syndrome/i],
  ["igg4", "IgG4相关病", /igg4-related/i],
  ["autoinflammatory", "自炎症性疾病", /adult-onset still|familial mediterranean fever|cryopyrin|autoinflammatory/i],
  ["crystal", "晶体性关节炎", /\bgout\b|calcium pyrophosphate|crystal arthritis/i]
];

function diseaseTags(text = "") {
  const matches = diseaseRules.filter(([, , pattern]) => pattern.test(text));
  if (!matches.length) {
    return { diseaseId: "other", diseaseIds: ["other"], diseaseZh: "其他/交叉病种" };
  }
  return {
    diseaseId: matches[0][0],
    diseaseIds: matches.map(([id]) => id),
    diseaseZh: matches.map(([, zh]) => zh).join(" · ")
  };
}

function topicTags(text = "") {
  const rules = [
    ["狼疮肾炎", /lupus nephritis|renal|kidney/i],
    ["细胞治疗", /CAR[- ]?T|cell therapy|chimeric antigen/i],
    ["B细胞与浆细胞", /B[- ]?cell|plasma cell|CD19|CD20|BAFF|belimumab|obinutuzumab/i],
    ["I型干扰素", /interferon|anifrolumab/i],
    ["神经精神受累", /neuropsychiatric|cognitive|central nervous/i],
    ["生物标志物", /biomarker|signature|proteomic|transcriptomic/i],
    ["妊娠与女性健康", /pregnan|maternal|fertility/i],
    ["真实世界研究", /real.world|cohort|registry|observational/i],
    ["缓解与达标治疗", /remission|LLDAS|treat.to.target|DORIS/i],
    ["靶向治疗", /inhibitor|monoclonal|biologic|therapy|treatment/i]
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag).slice(0, 5);
}

function inferPaperEvidence(types = [], text = "") {
  const joined = `${types.join(" ")} ${text}`;
  if (/randomized controlled trial|controlled clinical trial|phase [123]/i.test(joined)) {
    return ["随机对照/临床试验", "临床研究", "clinical-evidence"];
  }
  if (/systematic review|meta-analysis|practice guideline|guideline/i.test(joined)) {
    return ["系统评价/指南", "证据综合", "review"];
  }
  if (/cohort|observational|case-control|registry|cross-sectional/i.test(joined)) {
    return ["观察性研究", "临床观察", "observational"];
  }
  if (/mouse|mice|murine|in vitro|cell line|animal model/i.test(joined)) {
    return ["动物/细胞研究", "临床前研究", "preclinical"];
  }
  return ["其他研究", "研究类型未细分", "hypothesis"];
}

function mergeFetched(item) {
  const prior = existing.get(item.id) || {};
  return {
    ...item,
    titleZh: prior.titleZh || "",
    abstractZh: prior.abstractZh || "",
    translationMeta: prior.translationMeta || undefined
  };
}

async function searchPubMedIds() {
  const term = config.pubmed.query;
  const ids = [];
  let totalCount = 0;
  for (let retstart = 0; retstart < maxRecords; retstart += pageSize) {
    const params = new URLSearchParams({
      db: "pubmed",
      retmode: "json",
      retmax: String(pageSize),
      retstart: String(retstart),
      sort: "pub_date",
      term,
      datetype: "edat",
      mindate: utcDateOnly(fetchCutoff).replaceAll("-", "/"),
      maxdate: today.replaceAll("-", "/"),
      tool: "rheumatology_frontier",
      email: config.ncbi?.email || "site-maintainer@example.com"
    });
    if (ncbiApiKey) params.set("api_key", ncbiApiKey);
    const data = await fetchJsonPost("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params);
    const pageIds = data.esearchresult?.idlist || [];
    ids.push(...pageIds);
    totalCount = Number(data.esearchresult?.count || 0);
    if (!pageIds.length || ids.length >= totalCount) break;
    await sleep(requestIntervalMs);
  }
  if (totalCount > maxRecords) {
    throw new Error(`PubMed returned ${totalCount} records, exceeding maxRecords=${maxRecords}; refusing a truncated update`);
  }
  return [...new Set(ids)];
}

async function fetchPubMed() {
  if (!config.pubmed?.enabled) return [];
  const ids = await searchPubMedIds();
  const results = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    const params = new URLSearchParams({
      db: "pubmed",
      id: batch.join(","),
      retmode: "xml",
      tool: "rheumatology_frontier",
      email: config.ncbi?.email || "site-maintainer@example.com"
    });
    if (ncbiApiKey) params.set("api_key", ncbiApiKey);
    if (start > 0) await sleep(requestIntervalMs);
    const xml = await fetchTextPost("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", params);
    const articles = [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)].map(match => match[1]);
    for (const article of articles) {
      const pmid = textBetween(article, "PMID");
      const title = textBetween(article, "ArticleTitle");
      const abstract = allBetween(article, "AbstractText").join(" ");
      const doi = article.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/i)?.[1] || "";
      const publicationTypes = allBetween(article, "PublicationType");
      const [evidenceLevel, studyStage, conclusionStrength] = inferPaperEvidence(publicationTypes, `${title} ${abstract}`);
      results.push(mergeFetched({
        id: `pmid-${pmid}`,
        pmid,
        doi: decodeEntities(doi),
        source: "PubMed",
        sourceVerified: true,
        date: pubmedEntrezDate(article),
        dateType: "PubMed收录日期",
        title,
        abstract,
        ...diseaseTags(`${title} ${abstract}`),
        topics: topicTags(`${title} ${abstract}`),
        evidenceLevel,
        evidenceMethod: "基于文献类型自动标注",
        studyType: publicationTypes[0] || "Journal Article",
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        credibility: {
          studyStage,
          conclusionStrength,
          clinicalImplication: "研究类型标签用于辅助浏览，具体结论以原始摘要和论文全文为准。",
          riskNote: conclusionStrength === "observational"
            ? "观察性关联不能证明因果。"
            : conclusionStrength === "preclinical"
              ? "动物或细胞结果不能直接外推至患者。"
              : "研究类型由规则自动归类，具体内容以原文为准。",
          confidence: "自动标注"
        }
      }));
    }
  }
  return results.filter(item => item.pmid && item.title);
}

let fetched;
try {
  fetched = await fetchPubMed();
} catch (error) {
  console.error(`PubMed update failed: ${error.message}`);
  process.exit(1);
}

const items = dedupe(fetched)
  .filter(item => isWithinRollingWindow(item.date, retentionDays))
  .sort((a, b) => new Date(b.date) - new Date(a.date));
const previousPmids = new Set((existingPayload.items || []).filter(item => item.source === "PubMed").map(item => item.pmid));
const currentPmids = new Set(items.map(item => item.pmid));

const payload = {
  updatedAt: new Date().toISOString(),
  source: "PubMed",
  sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/",
  fetchWindowDays: fetchDays,
  retentionDays,
  itemCount: items.length,
  changes: {
    added: [...currentPmids].filter(pmid => !previousPmids.has(pmid)),
    removed: [...previousPmids].filter(pmid => !currentPmids.has(pmid))
  },
  items
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${items.length} verified PubMed records to ${output}`);

function dedupe(items) {
  return [...new Map(items.map(item => [item.pmid, item])).values()];
}

function utcDateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function isWithinRollingWindow(value, windowDays) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return false;
  const current = new Date(`${today}T00:00:00Z`);
  const cutoff = new Date(current);
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1));
  return date >= cutoff && date <= current;
}

async function fetchJsonPost(url, params) {
  const response = await fetchWithRetry(url, params);
  return response.json();
}

async function fetchTextPost(url, params) {
  const response = await fetchWithRetry(url, params);
  return response.text();
}

async function fetchWithRetry(url, params, maxAttempts = 7) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `RheumatologyFrontier/1.0 (${config.ncbi?.email || "site-maintainer@example.com"})`
      },
      body: params
    });
    if (response.ok) return response;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`${response.status} ${response.statusText} after ${attempt} attempt(s)`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const exponential = Math.min(60_000, 2 ** (attempt - 1) * 2_000);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : exponential + Math.floor(Math.random() * 1000);
    console.warn(`NCBI returned ${response.status}; retrying in ${Math.ceil(waitMs / 1000)}s (${attempt}/${maxAttempts})`);
    await sleep(waitMs);
  }
  throw new Error("NCBI request failed after retries");
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

