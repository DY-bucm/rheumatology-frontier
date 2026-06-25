import { loadItems, loadDiseases, cardHtml } from "./shared.js";

const elements = {
  list: document.querySelector("#feed-list"),
  search: document.querySelector("#search"),
  source: document.querySelector("#source-filter"),
  disease: document.querySelector("#disease-filter"),
  evidence: document.querySelector("#evidence-filter"),
  topic: document.querySelector("#topic-filter"),
  count: document.querySelector("#result-count"),
  stats: document.querySelector("#stats"),
  radar: document.querySelector("#topic-radar"),
  updated: document.querySelector("#updated-at"),
  diseaseGrid: document.querySelector("#disease-grid")
};

let allItems = [];

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function fillSelect(select, values) {
  values.forEach(value => select.insertAdjacentHTML("beforeend", `<option value="${value}">${value}</option>`));
}

function render() {
  const query = elements.search.value.trim().toLowerCase();
  const filtered = allItems.filter(item => {
    const haystack = [item.title, item.titleZh, item.summaryZh, item.abstract, item.pmid, item.nctId, ...(item.topics || [])].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (!elements.source.value || item.source === elements.source.value)
      && (!elements.disease.value || item.diseaseId === elements.disease.value)
      && (!elements.evidence.value || item.evidenceLevel === elements.evidence.value)
      && (!elements.topic.value || (item.topics || []).includes(elements.topic.value));
  });
  elements.count.textContent = `${filtered.length} 条`;
  elements.list.innerHTML = filtered.length ? filtered.map(cardHtml).join("") : `<div class="empty">当前筛选条件下没有记录。</div>`;
}

function renderDiseaseModules(diseases, items) {
  const counts = Object.fromEntries(diseases.map(disease => [disease.id, items.filter(item => item.diseaseId === disease.id).length]));
  elements.diseaseGrid.innerHTML = diseases.map(disease => `
    <button class="disease-card" data-disease="${disease.id}" style="--module-color:${disease.color}">
      <span class="module-count">${counts[disease.id] || 0}</span>
      <strong>${disease.zh}</strong>
      <small>${disease.en}</small>
      <p>${disease.description}</p>
    </button>`).join("");
  elements.diseaseGrid.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    elements.disease.value = button.dataset.disease;
    render();
    document.querySelector("#feed").scrollIntoView({ behavior: "smooth" });
  }));
}

function renderStats(items) {
  const trialCount = items.filter(item => item.nctId).length;
  const highCount = items.filter(item => item.credibility?.confidence === "high").length;
  elements.stats.innerHTML = `
    <div><strong>${items.length}</strong><span>当前记录</span></div>
    <div><strong>${trialCount}</strong><span>试验注册</span></div>
    <div><strong>${highCount}</strong><span>高可信度</span></div>`;
}

function renderRadar(items) {
  const counts = {};
  items.flatMap(item => item.topics || []).forEach(topic => counts[topic] = (counts[topic] || 0) + 1);
  elements.radar.innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([topic, count]) => `<button data-topic="${topic}"><span>${topic}</span><strong>${count}</strong></button>`).join("");
  elements.radar.querySelectorAll("button").forEach(button => button.addEventListener("click", () => {
    elements.topic.value = button.dataset.topic;
    render();
    document.querySelector("#feed").scrollIntoView({ behavior: "smooth" });
  }));
}

try {
  const [data, diseases] = await Promise.all([loadItems(), loadDiseases()]);
  allItems = (data.items || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  diseases.forEach(disease => elements.disease.insertAdjacentHTML("beforeend", `<option value="${disease.id}">${disease.zh}</option>`));
  fillSelect(elements.source, unique(allItems.map(item => item.source)));
  fillSelect(elements.evidence, unique(allItems.map(item => item.evidenceLevel)));
  fillSelect(elements.topic, unique(allItems.flatMap(item => item.topics || [])));
  renderStats(allItems);
  renderRadar(allItems);
  renderDiseaseModules(diseases, allItems);
  elements.updated.textContent = data.updatedAt ? `数据更新时间：${new Date(data.updatedAt).toLocaleString("zh-CN")}` : "";
  [elements.search, elements.disease, elements.source, elements.evidence, elements.topic].forEach(el => el.addEventListener("input", render));
  render();
} catch (error) {
  elements.list.innerHTML = `<div class="empty">数据加载失败：${error.message}</div>`;
}
