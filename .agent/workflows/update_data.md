---
description: How to update auction data and deploy
---

# Workflow: Update and Deploy Auction Data

This workflow describes the steps to crawl new data, clean it, and deploy it to the production application.

## 1. Run Crawler
Run the crawler to fetch the latest auction data.
Command:
```bash
cd auction-crawler
../.venv/bin/python court_auction_crawler.py
```
*Wait for the crawling process to finish.*

## 2. Clean Database
The crawler saves raw data. Run the cleaning script to create the optimized table for the viewer.
Command:
```bash
# In auction-crawler directory
../.venv/bin/python sqlite_cleaning.py
```
This updates `../auction-viewer/database/auction_data.db`.

## 3. Verify Data (Optional)
You can check if the database file was updated:
```bash
ls -l ../auction-viewer/database/auction_data.db
```

## 4. Commit and Push
The application reads the database file from the image, so you must commit the updated database to the repository.
```bash
cd .. # Go to project root
git add auction-viewer/database/auction_data.db
git commit -m "chore: update auction data $(date +'%Y-%m-%d')"
git push origin main
```

## 5. Deploy
Deploy the changes to Fly.io.
```bash
cd auction-viewer
flyctl deploy --remote-only
```
