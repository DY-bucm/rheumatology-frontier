import { loadItems, escapeHtml, formatDate, labelStrength, sourceLink, cardHtml } from "./shared.js";

const root = document.querySelector("#detail");
const id = new URLSearchParams(location.search).get("id");

try {
  const { items = [] } = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) throw new Error("未找到该研究记录");
  const c = item.credibility || {};
  const ai = item.aiRead || {};
  document.title = `${item.titleZh || item.title}｜风湿免疫前沿研究`;
  const related = items.filter(entry => entry.id !== item.id && (entry.topics || []).some(topic => (item.topics || []).includes(topic))).slice(0, 2);
  root.innerHTML = `
    <a class="back-link" href="index.html">← 返回研究情报</a>
    <article class="detail-article">
      <div class="card-meta"><span>${escapeHtml(formatDate(item.date))}</span><span>${escapeHtml(item.source)}</span><span class="disease-label">${escapeHtml(item.diseaseZh || "待归类")}</span><span class="stage">${escapeHtml(c.studyStage || item.studyType || "待分类")}</span></div>
      <h1>${escapeHtml(item.title)}</h1>
      ${item.titleZh ? `<p class="detail-title-zh">${escapeHtml(item.titleZh)}</p>` : ""}
      <div class="detail-tags">${(item.topics || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <section class="judgment-grid">
        <div><small>证据等级</small><strong>${escapeHtml(item.evidenceLevel || "待评估")}</strong></div>
        <div><small>结论强度</small><strong>${escapeHtml(labelStrength(c.conclusionStrength))}</strong></div>
        <div><small>可信度</small><strong>${escapeHtml(c.confidence || "待评估")}</strong></div>
      </section>
      <section><h2>文章重点</h2><p>${escapeHtml(item.insight || item.summaryZh || "尚无人工或 AI 解读。")}</p></section>
      <section class="credibility-box"><h2>可信度判断</h2>
        <dl>
          <div><dt>研究阶段</dt><dd>${escapeHtml(c.studyStage || "待判断")}</dd></div>
          <div><dt>临床含义</dt><dd>${escapeHtml(c.clinicalImplication || "需结合研究设计与完整结果判断。")}</dd></div>
          <div><dt>误读风险</dt><dd>${escapeHtml(c.riskNote || "避免超出原始研究设计进行外推。")}</dd></div>
        </dl>
      </section>
      ${item.abstract ? `<section><h2>英文原文摘要</h2><p class="abstract">${escapeHtml(item.abstract)}</p></section>` : ""}
      ${item.abstractZh ? `<section><h2>中文翻译</h2><p>${escapeHtml(item.abstractZh)}</p></section>` : `<section><h2>中文要点</h2><p>${escapeHtml(item.summaryZh || "暂未生成中文内容。")}</p></section>`}
      <section><h2>研究解读</h2><dl class="readout">
        <div><dt>研究类型</dt><dd>${escapeHtml(ai.studyType || item.studyType || "待分类")}</dd></div>
        <div><dt>核心发现</dt><dd>${escapeHtml(ai.keyFinding || "请查看原始来源。")}</dd></div>
        <div><dt>主要局限</dt><dd>${escapeHtml(ai.limitation || "尚未完成结构化评估。")}</dd></div>
        <div><dt>后续关注</dt><dd>${escapeHtml(ai.watchNext || "关注完整结果、重复验证与临床终点。")}</dd></div>
      </dl></section>
      <section class="source-box"><h2>来源标识</h2>
        <p>${item.pmid ? `PMID: ${escapeHtml(item.pmid)} · ` : ""}${item.doi ? `DOI: ${escapeHtml(item.doi)} · ` : ""}${item.nctId ? `NCT: ${escapeHtml(item.nctId)} · ` : ""}<a href="${escapeHtml(sourceLink(item))}" target="_blank" rel="noopener">打开原始来源 ↗</a></p>
      </section>
    </article>
    ${related.length ? `<section class="related"><p class="eyebrow">Related</p><h2>相关研究</h2><div class="feed-list">${related.map(cardHtml).join("")}</div></section>` : ""}`;
} catch (error) {
  root.innerHTML = `<div class="empty">${escapeHtml(error.message)}。<a href="index.html">返回首页</a></div>`;
}
