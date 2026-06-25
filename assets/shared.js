export const DATA_URL = "data/items.json";

export async function loadItems() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取数据：${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? { items: payload, updatedAt: "" } : payload;
}

export async function loadDiseases() {
  const response = await fetch("data/diseases.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取病种配置：${response.status}`);
  return response.json();
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

export function labelStrength(value = "") {
  const labels = {
    hypothesis: "假设性", preclinical: "临床前", observational: "观察性关联",
    "registered-trial": "试验注册", "clinical-signal": "临床信号",
    "clinical-evidence": "临床证据", review: "综述/共识"
  };
  return labels[value] || value || "待判断";
}

export function formatDate(value) {
  if (!value) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(value));
}

export function sourceLink(item) {
  return item.url || (item.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/` : "#");
}

export function cardHtml(item) {
  const credibility = item.credibility || {};
  const tags = (item.topics || []).slice(0, 3).map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
  return `<article class="research-card">
    <div class="card-meta">
      <span>${escapeHtml(formatDate(item.date))}</span>
      <span>${escapeHtml(item.source || "未知来源")}</span>
      <span class="disease-label">${escapeHtml(item.diseaseZh || "待归类")}</span>
      <span class="stage">${escapeHtml(credibility.studyStage || item.studyType || "待分类")}</span>
    </div>
    <h3><a href="detail.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a></h3>
    ${item.titleZh ? `<p class="title-zh">${escapeHtml(item.titleZh)}</p>` : ""}
    <p class="summary">${escapeHtml(item.summaryZh || item.abstractZh || "尚无中文要点，可查看英文原始来源。")}</p>
    <div class="tag-row">${tags}</div>
    <div class="evidence-row">
      <div><small>证据等级</small><strong>${escapeHtml(item.evidenceLevel || "待评估")}</strong></div>
      <div><small>结论强度</small><strong>${escapeHtml(labelStrength(credibility.conclusionStrength))}</strong></div>
      <div><small>可信度</small><strong>${escapeHtml(credibility.confidence || "待评估")}</strong></div>
    </div>
    ${credibility.riskNote ? `<p class="risk"><strong>误读风险：</strong>${escapeHtml(credibility.riskNote)}</p>` : ""}
    <div class="card-actions">
      <a href="detail.html?id=${encodeURIComponent(item.id)}">查看证据详情</a>
      <a href="${escapeHtml(sourceLink(item))}" target="_blank" rel="noopener">原始来源 ↗</a>
    </div>
  </article>`;
}
