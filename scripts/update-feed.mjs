name: Daily Rheumatology Feed Update

on:
  schedule:
    - cron: "10 22 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update-feed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Update latest one-day PubMed literature
        run: node scripts/update-feed.mjs --days 1 --limit 100 --output data/items.json
      - name: Apply exclusion rules
        run: node scripts/apply-exclusions.mjs data/items.json data/exclusion-rules.json data/items.json
      - name: Build quality report
        run: node scripts/build-quality-report.mjs
      - name: Verify site
        run: npm run check
      - name: Commit updated research data
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Update rheumatology research feed"
