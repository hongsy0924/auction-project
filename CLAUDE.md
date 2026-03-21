# Auction Compensation Analysis Tool

## Project Overview

Court auction property analyzer focused on urban planning facility compensation signals.
Dual-system: Python crawler (data collection) + Next.js frontend (analysis & display).

## Architecture

```
crawler/                    # Python — auction data collection + VWorld API enrichment
├── src/pipeline.py         # Main crawling entry point
├── src/storage.py          # Excel + SQLite persistence, land price enrichment
├── src/db/models.py        # SQLAlchemy ORM (AuctionRaw, AuctionCleaned)
├── src/models.py           # Pydantic models + COLUMN_MAPPING
├── pnu_generator.py        # PNU generation + VWorld API calls (land use, land price)
├── sqlite_cleaning.py      # Raw → cleaned table transformation
└── config.py               # API keys, crawling settings

web/                        # Next.js — frontend + analysis APIs
├── src/app/api/
│   ├── signal-top/         # Scored property endpoints (precompute, list, analysis)
│   ├── auction-list/       # Paginated auction list
│   └── auction-signals/    # Per-property signal detection (SSE)
├── src/lib/
│   ├── scoring/            # 0-1.0 weighted scoring engine (5 factors)
│   ├── eum/                # 토지이음 API (gosi notices, permits, hot zones)
│   ├── luris/              # LURIS urban plan facility lookup
│   ├── minutes/            # Council minutes search + SQLite cache layer
│   └── db.ts               # auction_data.db accessor
├── src/components/auction/ # UI components (table, signals, scoring tab)
├── src/types/auction.ts    # AuctionItem interface + column configs
└── database/               # SQLite files (auction_data.db, minutes_cache.db)
```

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
make deploy       # Fly.io deploy
```

## Key Data Flow

1. **Crawl**: Court auction API → PNU generation → VWorld land use (포함/저촉/접합) → VWorld land price (공시지가) → facility age (registDt) → SQLite `auction_list`
2. **Clean**: `auction_list` → COLUMN_MAPPING → `auction_list_cleaned` (한글 columns)
3. **Score**: Precompute reads cleaned data → EUM gosi matching → 4-factor scoring engine → `property_scores` cache
4. **Display**: Signal-top tab shows ranked properties with score breakdown, gosi stage; 보상 후보 tab shows 포함/저촉 filtered items with facility-type filters

## Scoring Engine (web/src/lib/scoring/)

4-factor weighted score (0-1.0):
- **facility_coverage** (0.40): 포함=1.0, 저촉=0.7, 접합=0.3
- **facility_age** (0.15): Years since registDt (18yr+=1.0)
- **gosi_stage** (0.30): Stage 0-4 (보상=1.0, 사업인정=0.8)
- **timing** (0.15): 유찰 count bonus

## External APIs

- **VWorld** (`VWORLD_API_KEY`): Land use (getLandUseAttr), land price (getIndvdLandPriceAttr)
- **EUM** (`EUM_API_ID`, `EUM_API_KEY`): Government notices (arMapList), permits (isDevList), restrictions (arLandUseInfo)
- **LURIS** (`LURIS_API_KEY`): Urban plan facilities
- **CLIK** (`CLIK_API_KEY`): Council minutes search
- **Gemini** (`GEMINI_API_KEY`): LLM analysis

## Conventions

- Korean column names in cleaned DB and frontend types
- All external API responses cached in SQLite (minutes_cache.db) with TTL
- Never commit .env files or API keys
- Keep council minutes search (/minutes page) untouched — it works independently
- Prefer editing existing files over creating new ones
