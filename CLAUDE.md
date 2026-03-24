# Auction Compensation Analysis Tool

## Project Overview

Court auction property analyzer focused on urban planning facility compensation signals.
Dual-system: Python crawler (data collection) + Next.js frontend (analysis & display).

## Architecture

```
crawler/                    # Python — auction data collection + VWorld API enrichment
├── src/pipeline.py         # Main crawling entry point
├── src/storage.py          # Excel + SQLite persistence, land price enrichment
├── src/browser_fetcher.py  # Symlink → browser.py (Playwright-based fetcher)
├── src/browser.py          # BrowserFetcher class (do NOT delete — symlinked)
├── src/db/models.py        # SQLAlchemy ORM (AuctionRaw, AuctionCleaned)
├── src/models.py           # Pydantic models + COLUMN_MAPPING
├── src/settings.py         # All config (API keys, crawling, browser settings)
├── pnu_generator.py        # PNU generation + VWorld API calls (land use, land price)
├── sqlite_cleaning.py      # Raw → cleaned table transformation
├── scripts/index_region_signals.py  # Council minutes pre-indexing
└── deploy/
    ├── run-crawl.sh        # Daily automation (cron entry point)
    ├── setup-ncp.sh        # NCP VM initialization
    └── crontab             # Cron schedule definition

web/                        # Next.js — frontend + analysis APIs
├── src/app/api/
│   ├── signal-top/         # Scored property endpoints (precompute, list, analysis)
│   ├── auction-list/       # Paginated auction list
│   └── auction-signals/    # Per-property signal detection (SSE)
├── src/lib/
│   ├── scoring/            # 0-1.0 weighted scoring engine (4 factors)
│   ├── eum/                # 토지이음 API (gosi notices, permits, hot zones)
│   │   ├── client.ts       # EUM API client, gosi stage classification
│   │   └── reverse-match.ts # Hot zone ↔ auction item matching (dong/읍면 level)
│   ├── luris/              # LURIS urban plan facility lookup
│   ├── minutes/            # Council minutes search + SQLite cache layer
│   │   └── cache/          # Cache modules (db, minutes, signals, eum)
│   └── db.ts               # auction_data.db accessor
├── src/components/auction/ # UI components (table, signals, scoring tab)
├── src/types/auction.ts    # AuctionItem interface + column configs
├── Dockerfile              # Docker build for Fly.io
├── fly.toml                # Fly.io app config (app: applemango, region: nrt)
└── database/               # SQLite files (auction_data.db, minutes_cache.db)
```

## Infrastructure

### NCP VM (175.106.98.80)
- **Purpose**: Daily crawler + EUM API proxy (static IP for whitelisting)
- **SSH**: `ssh ncp` (configured in ~/.ssh/config, key: ~/.ssh/ncp_key, user: crawler)
- **Cron**: Daily at 5 AM KST (UTC 20:00) — runs `crawler/deploy/run-crawl.sh`
- **Logs**: `/home/crawler/crawler.log`

### Fly.io (applemango.fly.dev)
- **Purpose**: Next.js web app + API
- **Region**: Tokyo (nrt), persistent volume at `/data/`
- **Deploy**: Must run from `web/` directory — `cd web && flyctl deploy -a applemango`
- **DB permissions**: sftp transfers create files as root:644. run-crawl.sh runs `chmod 666` after each transfer to prevent SQLITE_READONLY errors.
- **Secrets**: Managed via `flyctl secrets set KEY=VALUE -a applemango` (triggers machine restart)

### Daily Automation Pipeline (run-crawl.sh)
1. `git pull` latest code
2. Run crawler (Playwright → court auction API → 15k+ items)
3. VWorld enrichment (land use, land price)
4. SQLite cleaning (raw → cleaned table)
5. Transfer auction_data.db to Fly.io via sftp + chmod 666
6. Index region signals (council minutes)
7. Transfer minutes_cache.db to Fly.io + chmod 666
8. Trigger precompute (POST /api/signal-top/precompute)

## Build & Run

```bash
make install      # Install all dependencies
make crawl        # Run auction crawler (Python)
make dev          # Start Next.js dev server
make db-clean     # Transform raw → cleaned table
make lint         # ruff (Python) + eslint (TS)
make typecheck    # mypy + tsc --noEmit
make test         # pytest (skip real API)
make test-all     # pytest (with real API)
make deploy       # Fly.io deploy (runs from web/)
```

## Key Data Flow

1. **Crawl**: Court auction API → PNU generation → VWorld land use (포함/저촉/접합) → VWorld land price (공시지가) → facility age (registDt) → SQLite `auction_list`
2. **Clean**: `auction_list` → COLUMN_MAPPING → `auction_list_cleaned` (한글 columns)
3. **Score**: Precompute reads cleaned data → EUM gosi matching → 4-factor scoring engine → `property_scores` cache
4. **Hot Zone Alerts**: EUM stage 3-4 notices → extract dong names → reverse match against auction items (dong/읍면 level) → `hot_zone_alerts` table. Old alerts are cleared each precompute run.
5. **Display**: Signal-top tab shows ranked properties with score breakdown, gosi stage; 보상 후보 tab shows 포함/저촉 filtered items with facility-type filters

## Scoring Engine (web/src/lib/scoring/)

4-factor weighted score (0-1.0):
- **facility_coverage** (0.40): 포함=1.0, 저촉=0.7, 접합=0.3
- **facility_age** (0.15): Years since registDt (18yr+=1.0)
- **gosi_stage** (0.30): Stage 0-4 (보상=1.0, 사업인정=0.8)
- **timing** (0.15): 유찰 count bonus

## Gosi Stage Classification (web/src/lib/eum/client.ts)

- Stage 0: No relevant keywords
- Stage 1: 결정고시, 지구지정, 도시관리계획
- Stage 2: 실시계획
- Stage 3: 사업인정, 사업시행
- Stage 4: 보상계획, 보상협의, 수용재결, 토지보상

## External APIs

- **VWorld** (`VWORLD_API_KEY`): Land use (getLandUseAttr), land price (getIndvdLandPriceAttr)
- **EUM** (`EUM_API_ID`, `EUM_API_KEY`): Government notices (arMapList), permits (isDevList), restrictions (arLandUseInfo). Direct mode from Fly.io.
- **LURIS** (`LURIS_API_KEY`): Urban plan facilities (rate-limited, causes slow precompute)
- **CLIK** (`CLIK_API_KEY`): Council minutes search
- **Gemini** (`GEMINI_API_KEY`): LLM analysis (gemini-3.1-pro-preview), embeddings (gemini-embedding-001)

## Conventions

- Korean column names in cleaned DB and frontend types
- All external API responses cached in SQLite (minutes_cache.db) with TTL
- Never commit .env files or API keys
- Keep council minutes search (/minutes page) untouched — it works independently
- Prefer editing existing files over creating new ones
- browser_fetcher.py is a symlink to browser.py — do not delete browser.py
