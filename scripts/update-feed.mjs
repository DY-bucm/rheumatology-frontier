import fs from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, value, index, list) => {
  if (value.startsWith("--")) acc.push([value.slice(2), list[index + 1] && !list[index + 1].startsWith("--") ? list[index + 1] : true]);
  return acc;
}, []));
const days = Number(args.days || 1);
const limit = Number(args.limit || 20);
const output = String(args.output || "data/items.json");
const config = JSON.parse(await fs.readFile("data/source-config.json", "utf8"));
const existingPayload = await readJson(output, { items: [] });
const existing = new Map((existingPayload.items || existingPayload || []).map(item => [item.id, item]));

function stripTags(value = "") {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function textBetween(xml, tag) {
  return stripTags(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}
function allBetween(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(match => stripTags(match[1]));
}
function pubmedEntrezDate(article) {
  const history = article.match(/<History>([\s\S]*?)<\/History>/i)?.[1] || "";
  const block = history.match(/<PubMedPubDate PubStatus="entrez">([\s\S]*?)<\/PubMedPubDate>/i)?.[1]
    || history.match(/<PubMedPubDate PubStatus="pubmed">([\s\S]*?)<\/PubMedPubDate>/i)?.[1]
    || "";
  const year = textBetween(block, "Year");
  const month = textBetween(block, "Month").padStart(2, "0");
  const day = textBetween(block, "Day").padStart(2, "0");
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}
function topicTags(text = "") {
  const rules = [
    ["狼疮肾炎", /lupus nephritis|renal|kidney/i],
    ["细胞治疗", /CAR[- ]?T|cell therapy|chimeric antigen/i],
    ["B细胞与浆细胞", /B[- ]?cell|plasma cell|CD19|CD20|BAFF|belimumab|obinutuzumab/i],
    ["I型干扰素", /interferon|anifrolumab/i],
    ["神经精神狼疮", /neuropsychiatric|cognitive|central nervous/i],
    ["生物标志物", /biomarker|signature|proteomic|transcriptomic/i],
    ["妊娠与女性健康", /pregnan|maternal|fertility/i],
    ["真实世界研究", /real.world|cohort|registry|observational/i],
    ["缓解与达标治疗", /remission|LLDAS|treat.to.target|DORIS/i],
    ["靶向治疗", /inhibitor|monoclonal|biologic|therapy|treatment/i]
  ];
  return rules.filter(([, regex]) => regex.test(text)).map(([tag]) => tag).slice(0, 4);
}
function diseaseTag(text = "") {
  const rules = [
    ["pediatric","儿童风湿病",/juvenile idiopathic arthritis|juvenile systemic lupus|juvenile dermatomyositis|pediatric rheumatic/i],
    ["ra","类风湿关节炎",/rheumatoid arthritis/i],
    ["sle","系统性红斑狼疮",/systemic lupus erythematosus|lupus nephritis|neuropsychiatric lupus/i],
    ["sjogren","干燥综合征",/sj[öo]gren/i],
    ["ssc","系统性硬化症",/systemic sclerosis|scleroderma/i],
    ["myositis","特发性炎性肌病",/inflammatory myopath|dermatomyositis|polymyositis|necrotizing myopathy|antisynthetase/i],
    ["spa","脊柱关节炎谱系",/spondyloarthritis|ankylosing spondylitis|psoriatic arthritis/i],
    ["vasculitis","系统性血管炎",/vasculitis|giant cell arteritis|takayasu|beh[cç]et|granulomatosis with polyangiitis|microscopic polyangiitis/i],
    ["aps","抗磷脂综合征",/antiphospholipid syndrome/i],
    ["igg4","IgG4相关病",/igg4-related/i],
    ["autoinflammatory","自炎症性疾病",/adult-onset still|familial mediterranean fever|cryopyrin|autoinflammatory/i],
    ["crystal","晶体性关节炎",/\bgout\b|calcium pyrophosphate|crystal arthritis/i]
  ];
  const found = rules.find(([, , regex]) => regex.test(text));
  return found ? { diseaseId: found[0], diseaseZh: found[1] } : { diseaseId: "other", diseaseZh: "其他/交叉病种" };
}
function inferPaperEvidence(types = [], text = "") {
  const joined = `${types.join(" ")} ${text}`;
  if (/randomized controlled trial|phase [123]/i.test(joined)) return ["随机对照试验", "临床研究", "clinical-evidence"];
  if (/systematic review|meta-analysis|guideline/i.test(joined)) return ["系统评价/指南", "证据综合", "review"];
  if (/cohort|observational|case-control|registry/i.test(joined)) return ["队列/真实世界", "临床观察", "observational"];
  if (/mouse|mice|murine|in vitro|cell line/i.test(joined)) return ["动物/细胞研究", "临床前研究", "preclinical"];
  return ["转化研究", "研究论文", "hypothesis"];
}
function merge(item) {
  const prior = existing.get(item.id) || {};
  return { ...item, ...prior, ...item, titleZh: prior.titleZh || item.titleZh || "", abstractZh: prior.abstractZh || "", summaryZh: prior.summaryZh || "", insight: prior.insight || "", aiRead: prior.aiRead || item.aiRead, credibility: prior.credibility?.confidence ? prior.credibility : item.credibility };
}

async function fetchPubMed() {
  if (!config.pubmed?.enabled) return [];
  const term = `${config.pubmed.query} AND ("last ${days} days"[EDat])`;
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&sort=pub+date&term=${encodeURIComponent(term)}`;
  const search = await fetchJson(searchUrl);
  const ids = search.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const xml = await fetchText(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml`);
  const articles = [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)].map(match => match[1]);
  return articles.map(article => {
    const pmid = textBetween(article, "PMID");
    const title = textBetween(article, "ArticleTitle");
    const abstract = allBetween(article, "AbstractText").join(" ");
    const date = pubmedEntrezDate(article);
    const doi = [...article.matchAll(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/gi)][0]?.[1] || "";
    const publicationTypes = allBetween(article, "PublicationType");
    const [evidenceLevel, studyStage, conclusionStrength] = inferPaperEvidence(publicationTypes, `${title} ${abstract}`);
    const disease = diseaseTag(`${title} ${abstract}`);
    return merge({
      id: `pmid-${pmid}`, pmid, doi, source: "PubMed", date, dateType: "PubMed indexed date", title, abstract,
      ...disease,
      topics: topicTags(`${title} ${abstract}`), evidenceLevel, studyType: publicationTypes[0] || "Journal article",
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      credibility: {
        studyStage, conclusionStrength,
        clinicalImplication: conclusionStrength === "clinical-evidence" ? "需结合终点、效应量和安全性评估临床意义。" : "当前证据不应直接解释为已证实的患者获益。",
        riskNote: conclusionStrength === "observational" ? "观察性关联不能证明因果。" : conclusionStrength === "preclinical" ? "动物或细胞结果不能直接外推到患者。" : "需核对完整研究设计和结果。",
        confidence: "medium"
      }
    });
  }).filter(item => item.pmid && item.title);
}

async function fetchTrials() {
  if (!config.clinicalTrials?.enabled) return [];
  const query = config.clinicalTrials.conditions.map(term => `AREA[ConditionSearch]${term}`).join(" OR ");
  const url = `https://clinicaltrials.gov/api/v2/studies?query.cond=${encodeURIComponent(query)}&pageSize=${Math.min(limit, 100)}&format=json`;
  const data = await fetchJson(url);
  return (data.studies || []).map(study => {
    const p = study.protocolSection || {};
    const id = p.identificationModule?.nctId;
    const title = p.identificationModule?.briefTitle || p.identificationModule?.officialTitle || "";
    const summary = p.descriptionModule?.briefSummary || "";
    const status = p.statusModule?.overallStatus || "Unknown";
    const date = p.statusModule?.studyFirstPostDateStruct?.date || p.statusModule?.startDateStruct?.date || "";
    const phases = p.designModule?.phases || [];
    const disease = diseaseTag(`${title} ${summary} ${(p.conditionsModule?.conditions || []).join(" ")}`);
    return merge({
      id: `nct-${id}`, nctId: id, source: "ClinicalTrials.gov", date: normalizeDate(date), title,
      ...disease,
      abstract: summary, topics: topicTags(`${title} ${summary}`), evidenceLevel: "临床试验注册",
      studyType: phases.join("/") || "Clinical trial registration",
      url: `https://clinicaltrials.gov/study/${id}`,
      credibility: {
        studyStage: `试验注册 · ${status}`, conclusionStrength: "registered-trial",
        clinicalImplication: "注册信息说明研究正在规划或实施，不代表疗效或安全性已有结论。",
        riskNote: "试验注册不能解读为试验成功；需等待正式结果和同行评议。",
        confidence: "high"
      }
    });
  }).filter(item => item.nctId && item.title);
}

const settled = await Promise.allSettled([fetchPubMed()]);
const failures = settled.filter(result => result.status === "rejected");
failures.forEach(result => console.error("Source update failed:", result.reason?.message || result.reason));
const fetched = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
if (!fetched.length && failures.length) process.exitCode = 1;
const sourceFailed = failures.length === settled.length;
const items = sourceFailed
  ? [...existing.values()]
  : dedupe(fetched).sort((a, b) => new Date(b.date) - new Date(a.date));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`Wrote ${items.length} items to ${output}`);

function dedupe(items) {
  return [...new Map(items.map(item => [item.id, item])).values()];
}
function normalizeDate(value = "") {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}
async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "SLEFrontierResearch/1.0 (research monitoring)" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}
async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "SLEFrontierResearch/1.0 (research monitoring)" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
