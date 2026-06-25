import { loadItems, loadDiseases, cardHtml } from "./shared.js";

const elements = {
  list: document.querySelector("#feed-list"),
  search: document.querySelector("#search"),
  source: document.querySelector("#source-filter"),
  disease: document.querySelector("#disease-filter"),
  topic: document.querySelector("#topic-filter"),
  count: document.querySelector("#result-count"),
  stats: document.querySelector("#stats"),
  radar: document.querySelector("#topic-radar"),
  updated: document.querySelector("#updated-at"),
  diseaseGrid: document.querySelector("#disease-grid"),
  sourceStatus: document.querySelector("#source-status"),
  windowButtons: [...document.querySelectorAll("[data-window]")]
};

let rollingItems = [];
let diseases = [];
let activeWindow = 1;

function isPublishable(item) {
  return Boolean(
    item.titleZh
    && item.translationMeta?.validationPassed === true
    && (!item.abstract || item.abstractZh)
  );
}

function isWithinDays(item, days) {
  if (!item.date) return false;
  const itemDate = new Date(`${item.date}T00:00:00Z`);
  if (Number.isNaN(itemDate.valueOf())) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  return itemDate >= cutoff && itemDate <= today;
}

function currentItems() {
  return rollingItems.filter(item => isWithinDays(item, activeWindow));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function fillSelect(select, values) {
  values.forEach(value => select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`));
}

function filteredItems(items) {
  const query = elements.search.value.trim().toLowerCase();
  return items.filter(item => {
    const haystack = [item.title, item.titleZh, item.abstractZh, item.abstract, item.pmid, ...(item.topics || [])]
      .join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (!elements.source.value || item.source === elements.source.value)
      && (!elements.disease.value || (item.diseaseIds || [item.diseaseId]).includes(elements.disease.value))
      && (!elements.topic.value || (item.topics || []).includes(elements.topic.value));
  });
}

function renderFeed() {
  const filtered = filteredItems(currentItems());
  elements.count.textContent = `${filtered.length} 条`;
  elements.list.innerHTML = filtered.length
    ? filtered.map(cardHtml).join("")
    : `<div class="empty">PubMed 近 ${activeWindow} 天暂无符合条件的新增文献。</div>`;
}

function renderDiseaseModules(items) {
  const counts = Object.fromEntries(diseases.map(disease => [
    disease.id,
    items.filter(item => (item.diseaseIds || [item.diseaseId]).includes(disease.id)).length
  ]));
  elements.diseaseGrid.innerHTML = diseases.map(disease => `
    <button class="disease-card" data-disease="${disease.id}" style="--module-color:${disease.color}">
      <span class="module-count">${counts[disease.id] || 0}</span>
      <strong>${disease.zh}</strong>
      <small>${disease.en}</small>
      <p>${disease.description}</p>
    </button>`).join("");
  elements.diseaseGrid.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    elements.disease.value = button.dataset.disease;
    renderFeed();
    document.querySelector("#feed").scrollIntoView({ behavior: "smooth" });
  }));
}

function renderStats(items) {
  const linkedCount = items.filter(item => item.pmid && item.url).length;
  const diseaseCount = new Set(items.map(item => item.diseaseId).filter(Boolean)).size;
  elements.stats.innerHTML = `
    <div><strong>${items.length}</strong><span>近 ${activeWindow} 天文献</span></div>
    <div><strong>${linkedCount}</strong><span>PMID 可追溯</span></div>
    <div><strong>${diseaseCount}</strong><span>涉及病种</span></div>`;
}

function renderRadar(items) {
  const counts = {};
  items.flatMap(item => item.topics || []).forEach(topic => counts[topic] = (counts[topic] || 0) + 1);
  elements.radar.innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([topic, count]) => `<button data-topic="${topic}"><span>${topic}</span><strong>${count}</strong></button>`)
    .join("");
  elements.radar.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    elements.topic.value = button.dataset.topic;
    renderFeed();
    document.querySelector("#feed").scrollIntoView({ behavior: "smooth" });
  }));
}

function renderWindow() {
  const items = currentItems();
  elements.windowButtons.forEach(button => {
    const selected = Number(button.dataset.window) === activeWindow;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderStats(items);
  renderDiseaseModules(items);
  renderRadar(items);
  renderFeed();
}

try {
  const [data, diseaseData] = await Promise.all([loadItems(), loadDiseases()]);
  diseases = diseaseData;
  rollingItems = (data.items || [])
    .filter(item => item.source === "PubMed" && isWithinDays(item, 5) && isPublishable(item))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  diseases.forEach(disease => elements.disease.insertAdjacentHTML(
    "beforeend",
    `<option value="${disease.id}">${disease.zh}</option>`
  ));
  fillSelect(elements.source, unique(rollingItems.map(item => item.source)));
  fillSelect(elements.topic, unique(rollingItems.flatMap(item => item.topics || [])));
  elements.updated.textContent = data.updatedAt
    ? `数据更新时间：${new Date(data.updatedAt).toLocaleString("zh-CN")}`
    : "";
  elements.sourceStatus.innerHTML = `
    <p><strong>PubMed</strong> 原始标题与摘要</p>
    <p>滚动窗口：${data.retentionDays || 5} 天</p>
    <p>当前记录：${data.itemCount ?? rollingItems.length} 条</p>
    <p>本次新增：${data.changes?.added?.length ?? 0} 条 · 移除：${data.changes?.removed?.length ?? 0} 条</p>
    <p>中文内容：DeepSeek 忠实翻译并通过保真校验</p>
    <p>公开展示：${rollingItems.length} 条</p>`;
  elements.windowButtons.forEach(button => button.addEventListener("click", () => {
    activeWindow = Number(button.dataset.window);
    renderWindow();
  }));
  [elements.search, elements.disease, elements.source, elements.topic]
    .forEach(element => element.addEventListener("input", renderFeed));
  renderWindow();
} catch (error) {
  elements.list.innerHTML = `<div class="empty">数据加载失败：${error.message}</div>`;
}
