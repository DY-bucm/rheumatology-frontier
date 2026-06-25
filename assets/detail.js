import { loadItems, escapeHtml, formatDate, sourceLink, cardHtml } from "./shared.js";

const root = document.querySelector("#detail");
const id = new URLSearchParams(location.search).get("id");

try {
  const { items = [] } = await loadItems();
  const item = items.find(entry =>
    entry.id === id
    && entry.titleZh
    && entry.translationMeta?.validationPassed === true
    && (!entry.abstract || entry.abstractZh)
  );
  if (!item) throw new Error("未找到该研究记录");
  document.title = `${item.titleZh || item.title}｜每日一看，科研小站`;
  const related = items.filter(entry =>
    entry.id !== item.id
    && entry.titleZh
    && entry.translationMeta?.validationPassed === true
    && (!entry.abstract || entry.abstractZh)
    && (entry.topics || []).some(topic => (item.topics || []).includes(topic))
  ).slice(0, 2);
  root.innerHTML = `
    <a class="back-link" href="index.html">← 返回研究情报</a>
    <article class="detail-article">
      <div class="card-meta"><span>${escapeHtml(formatDate(item.date))}</span><span>${escapeHtml(item.source)}</span><span class="disease-label">${escapeHtml(item.diseaseZh || "其他")}</span></div>
      <h1>${escapeHtml(item.title)}</h1>
      ${item.titleZh ? `<p class="detail-title-zh">${escapeHtml(item.titleZh)} <small class="translation-label">DeepSeek 翻译</small></p>` : ""}
      <div class="detail-tags">${(item.topics || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      ${item.abstract ? `<section><h2>英文原文摘要</h2><p class="abstract">${escapeHtml(item.abstract)}</p></section>` : ""}
      <section><h2>中文翻译 <small class="translation-label">DeepSeek 翻译</small></h2><p>${escapeHtml(item.abstractZh || "PubMed 未提供英文摘要。")}</p></section>
      <section class="source-box"><h2>来源标识</h2>
        <p>${item.pmid ? `PMID: ${escapeHtml(item.pmid)} · ` : ""}${item.doi ? `DOI: ${escapeHtml(item.doi)} · ` : ""}${item.nctId ? `NCT: ${escapeHtml(item.nctId)} · ` : ""}<a href="${escapeHtml(sourceLink(item))}" target="_blank" rel="noopener">打开原始来源 ↗</a></p>
      </section>
    </article>
    ${related.length ? `<section class="related"><p class="eyebrow">Related</p><h2>相关研究</h2><div class="feed-list">${related.map(cardHtml).join("")}</div></section>` : ""}`;
} catch (error) {
  root.innerHTML = `<div class="empty">${escapeHtml(error.message)}。<a href="index.html">返回首页</a></div>`;
}
