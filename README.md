# 风湿免疫前沿研究

静态优先的风湿免疫多病种研究情报网站，聚合 PubMed 与 ClinicalTrials.gov，提供中英文内容、证据等级、研究阶段、结论强度和误读风险。

## 病种模块

当前按 12 个一级模块组织：

- 类风湿关节炎
- 系统性红斑狼疮
- 干燥综合征
- 系统性硬化症
- 特发性炎性肌病
- 脊柱关节炎谱系
- 系统性血管炎
- 抗磷脂综合征
- IgG4 相关病
- 自炎症性疾病
- 晶体性关节炎
- 儿童风湿病

分类范围参考 American College of Rheumatology 的 Diseases & Conditions 目录及 NIAMS 自身免疫疾病资料；本项目聚焦免疫介导、炎症性和晶体性疾病，没有把全部非炎症性肌骨疾病纳入一级模块。

## 本地使用

```powershell
npm run update
node scripts/apply-exclusions.mjs data/items.json data/exclusion-rules.json data/items.json
npm run check
python -m http.server 8000
```

打开 `http://localhost:8000`。不要直接双击 HTML；浏览器可能阻止本地 JSON 请求。

## AI 翻译

AI 只在后端更新脚本中运行。支持：

- `AI_API_KEY`、`AI_API_BASE_URL`、`AI_MODEL`
- 或 `OPENAI_API_KEY`、`OPENAI_MODEL`

没有密钥时，论文与试验数据仍会更新，只跳过翻译和结构化解读。不要把密钥写入前端代码、仓库文件或聊天内容。

## GitHub Pages

1. 将仓库推送到 GitHub。
2. 在 Settings → Pages 中选择从 `main` 分支根目录部署。
3. 在 Settings → Secrets and variables → Actions 中配置密钥和模型变量。
4. 手动运行一次 `Daily Rheumatology Feed Update`，检查更新、翻译和质量报告。

定时任务每天北京时间 06:10 左右运行。
