# 每日一看，科研小站

一个静态优先的风湿免疫科研文献小站。

首页提供两个时间视图：

- 最新 1 天：查看当天 PubMed 新收录文献。
- 近 5 天文献：查看完整滚动窗口。

每日任务会重新核对 PubMed 完整近 5 天结果，而不是只依赖前一天的数据。这样可以补偿 GitHub Actions 偶发失败或 PubMed 延迟收录。数据按 PMID 去重，超过 5 天的记录自动移除。

前台只展示已完成 DeepSeek 翻译并通过保真校验的记录；未完成记录保留在后台，后续自动重试。

## 病种模块

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

一篇文献可同时归入多个病种模块。病种和研究类型由规则自动标注，具体结论以 PubMed 原始记录和论文全文为准。

## 数据真实性

- 英文标题、摘要、PMID 和 DOI 来自 PubMed。
- 每条记录链接到对应 PubMed 页面。
- 日期使用 PubMed 收录日期，不使用可能超前的期刊卷期日期。
- 质量门禁检查重复 PMID、未来日期、超出 5 天窗口、错误链接、乱码和翻译数字丢失。
- 任一严重错误都会让 GitHub Actions 失败，阻止错误数据提交。

## DeepSeek 翻译

DeepSeek 只在 GitHub Actions 后端运行，只写入中文标题和摘要，不覆盖英文原文、PMID、DOI、病种或其他来源字段。

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中配置：

- `DEEPSEEK_API_KEY`

可选配置：

- `NCBI_API_KEY`：提高 PubMed E-utilities 请求额度，减少 GitHub Actions 共享 IP 出现 429 限流。未配置时脚本也会自动限速并指数退避重试。

工作流默认使用：

- API：`https://api.deepseek.com`
- 模型：`deepseek-chat`

翻译必须通过数字、百分比、医学缩写和标识符保留检查，否则不会公开。失败记录会保留原因和累计尝试次数，下一次更新优先重试。

## 本地检查

```powershell
npm run update
node scripts/apply-exclusions.mjs data/items.json data/exclusion-rules.json data/items.json
node scripts/build-quality-report.mjs
npm run check
node scripts/serve-local.mjs 8765
```

打开 `http://127.0.0.1:8765/`。

## GitHub Pages

1. 将文件上传到 GitHub 仓库。
2. 在 `Settings → Pages` 中选择从 `main` 分支根目录部署。
3. 配置 `DEEPSEEK_API_KEY`。
4. 可选配置 `NCBI_API_KEY`。
5. 手动运行一次 `Daily Rheumatology Feed Update`。
6. 确认数据更新、DeepSeek 翻译、质量报告和提交步骤均为绿色。

定时任务每天北京时间 06:10 左右运行。
