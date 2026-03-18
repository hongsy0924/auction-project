# Application Guide: How the Frontend and Backend Work

A plain-language guide to every piece of the auction analysis application. Written for someone who understands basic programming but hasn't built a full web application before.

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [What Is Next.js?](#what-is-nextjs)
3. [How the App Is Organized](#how-the-app-is-organized)
4. [Pages and Routing](#pages-and-routing)
5. [The Three Tabs](#the-three-tabs)
6. [API Routes: The Backend Inside Next.js](#api-routes-the-backend-inside-nextjs)
7. [SQLite: The Database](#sqlite-the-database)
8. [The Crawler: Where Data Comes From](#the-crawler-where-data-comes-from)
9. [The Scoring Engine: How Properties Are Ranked](#the-scoring-engine-how-properties-are-ranked)
10. [External APIs: The Data Sources](#external-apis-the-data-sources)
11. [Caching: Why We Don't Call APIs Every Time](#caching-why-we-dont-call-apis-every-time)
12. [Authentication: Who Can Use the App](#authentication-who-can-use-the-app)
13. [Server-Sent Events: Real-Time Progress](#server-sent-events-real-time-progress)
14. [React Components: How the UI Is Built](#react-components-how-the-ui-is-built)
15. [TypeScript: Why Types Matter](#typescript-why-types-matter)
16. [The Complete Data Journey](#the-complete-data-journey)
17. [Docker: Packaging the App](#docker-packaging-the-app)
18. [Key Files Reference](#key-files-reference)

---

## The Big Picture

This application helps you find court auction properties that might be involved in government compensation (보상). The idea: if the government is planning to build a road or facility through a piece of land, the owner will eventually be compensated. If you buy that land at auction for cheap, you profit when compensation happens.

The app has three main jobs:

1. **Collect** — A Python crawler grabs auction listings from the court system every day
2. **Analyze** — The app checks each property against government databases (notices, permits, council minutes) to find compensation signals
3. **Rank** — A scoring engine rates each property from 0 to 1.0 based on how likely compensation is and how good the price is

Think of it as a metal detector for auction properties — it scans thousands of listings and highlights the ones with hidden value.

---

## What Is Next.js?

**Next.js** is a framework for building web applications with React. Think of React as a toolkit for building user interfaces (buttons, tables, forms). Next.js adds the stuff React doesn't have: routing (different pages), server-side code (talking to databases), and deployment.

### Why Next.js is special

Most web apps need two separate programs:
- A **frontend** (what users see in the browser — HTML, CSS, JavaScript)
- A **backend** (a server that talks to databases and APIs)

Next.js combines both into one project. Your frontend components and backend API endpoints live in the same codebase, share the same types, and deploy as one unit.

```
Traditional setup:              Next.js setup:
┌──────────┐  ┌──────────┐     ┌──────────────────┐
│ Frontend │──│ Backend  │     │    Next.js        │
│ (React)  │  │ (Express)│     │ ┌──────────────┐ │
└──────────┘  └──────────┘     │ │ Frontend     │ │
  separate      separate       │ │ (React pages)│ │
  deploy        deploy         │ ├──────────────┤ │
                               │ │ Backend      │ │
                               │ │ (API routes) │ │
                               │ └──────────────┘ │
                               └──────────────────┘
                                  one deploy
```

**Our version:** Next.js 16 with React 19.

---

## How the App Is Organized

```
web/
├── src/
│   ├── app/                    ← Pages and API routes (Next.js App Router)
│   │   ├── layout.tsx          ← Root layout (wraps every page)
│   │   ├── page.tsx            ← Home page (/)
│   │   ├── minutes/
│   │   │   └── page.tsx        ← Minutes search page (/minutes)
│   │   └── api/                ← Backend API endpoints
│   │       ├── auction-list/   ← GET /api/auction-list
│   │       ├── auction-signals/← GET+POST /api/auction-signals
│   │       ├── signal-top/     ← GET /api/signal-top
│   │       ├── login/          ← POST /api/login
│   │       └── logout/         ← POST /api/logout
│   │
│   ├── components/             ← Reusable UI pieces
│   │   ├── auction/            ← Table, search, signals, scoring tab
│   │   └── auth/               ← Login form
│   │
│   ├── lib/                    ← Backend logic (databases, APIs, scoring)
│   │   ├── db.ts               ← SQLite connection for auction data
│   │   ├── eum/                ← EUM API client (government notices)
│   │   ├── luris/              ← LURIS API client (facility data)
│   │   ├── scoring/            ← 5-factor scoring engine
│   │   └── minutes/            ← Council minutes search + cache layer
│   │
│   ├── types/                  ← TypeScript type definitions
│   │   └── auction.ts          ← AuctionItem interface, column configs
│   │
│   └── context/                ← React context (shared state)
│       └── AuthContext.tsx      ← Login/logout state management
│
├── database/                   ← SQLite database files
│   ├── auction_data.db         ← Auction listings (from crawler)
│   └── minutes_cache.db        ← Cached API responses + scores
│
└── package.json                ← Dependencies and scripts
```

### The key idea: `app/` vs `lib/` vs `components/`

| Directory | What it does | Runs where |
|-----------|-------------|------------|
| `app/` | Defines pages (what URL shows what) and API endpoints | Pages: browser. APIs: server |
| `lib/` | Business logic — database queries, API calls, scoring | Server only |
| `components/` | UI building blocks — tables, buttons, forms | Browser only |

---

## Pages and Routing

Next.js uses **file-based routing**. The file structure inside `app/` determines the URLs:

| File | URL | What it shows |
|------|-----|--------------|
| `app/page.tsx` | `/` | Main auction page (all three tabs) |
| `app/minutes/page.tsx` | `/minutes` | Council minutes search |
| `app/api/auction-list/route.ts` | `/api/auction-list` | API endpoint (returns JSON) |

### How a page works

```tsx
// app/page.tsx — this is the simplest possible page
import AuctionPageClient from "@/components/auction/AuctionPageClient";

export default function Home() {
  return <AuctionPageClient />;
}
```

That's it. Next.js sees this file at `app/page.tsx` and makes it available at `/`. The actual UI logic lives in the component.

### Layout: the wrapper around every page

```tsx
// app/layout.tsx (simplified)
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ClientProviders>  {/* Auth context, etc. */}
          {children}        {/* Whatever page you're on */}
        </ClientProviders>
      </body>
    </html>
  );
}
```

The layout wraps every page. It sets up fonts, metadata (page title), and the auth context. You never see this directly — it's the invisible frame around everything.

---

## The Three Tabs

The main page has three tabs that show different views of the same data:

### Tab 1: 경매물건 (Auction List)

**What it does:** A searchable, paginated table of all auction properties.

**How it works:**
1. Component loads → calls `GET /api/auction-list?page=1&per_page=20`
2. API queries `auction_list_cleaned` table in SQLite
3. Returns 20 rows + total count
4. User can search by keyword (searches across 21 columns)
5. Each row can be expanded to see signals for that property

**Think of it as:** A spreadsheet of all auction listings, with a search bar.

### Tab 2: 투자시그널 (Investment Signals)

**What it does:** Shows the top-scored properties ranked by investment potential.

**How it works:**
1. Component loads → calls `GET /api/signal-top?page=1&sort=score`
2. API reads pre-computed scores from `property_scores` cache table
3. Returns ranked properties with score breakdowns
4. Shows "hot zone" alerts for areas with active compensation (stage 3-4)

**The scores come from a background job** (precompute) that analyzes every property against government data. This runs on-demand, not in real-time, because it takes minutes to process hundreds of properties.

**Think of it as:** A leaderboard of the most promising auction properties.

### Tab 3: 회의록 검색 (Minutes Search)

**What it does:** Searches council meeting minutes for keywords related to land development.

**How it works:**
1. User types a search query (e.g., "역삼동 도로")
2. Component calls `POST /api/minutes-search` with the query
3. Backend searches CLIK API (council minutes database)
4. Downloads full meeting transcripts
5. Uses AI (Gemini) to find the most relevant passages
6. Streams results back in real-time

**Think of it as:** A smart search engine for government meeting records.

---

## API Routes: The Backend Inside Next.js

API routes are server-side endpoints that your frontend calls to get data. They live in `app/api/` and handle HTTP requests.

### How an API route works

```
Browser                    Next.js Server               Database/API
───────                    ──────────────               ────────────
GET /api/auction-list  →   route.ts handler     →      SQLite query
                       ←   { data: [...], total }  ←   rows returned
```

```typescript
// app/api/auction-list/route.ts (simplified)
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword") || "";
    const page = Number(searchParams.get("page")) || 1;

    const result = await searchAuctions(keyword, page, 20);

    return Response.json(result);
}
```

The function name `GET` means it handles GET requests. `POST` handles POST requests. That's how Next.js knows which HTTP method this endpoint responds to.

### Our API endpoints

| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/api/auction-list` | GET | Search/browse auction listings |
| `/api/auction-signals` | GET | Get cached signals for a property |
| `/api/auction-signals` | POST | Stream full signal analysis (SSE) |
| `/api/signal-top` | GET | Get ranked properties by score |
| `/api/signal-top/precompute` | POST | Trigger background scoring job |
| `/api/signal-top/analysis` | GET | Get AI analysis markdown for a property |
| `/api/minutes-search` | POST | Stream council minutes search (SSE) |
| `/api/login` | POST | Authenticate user, set JWT cookie |
| `/api/logout` | POST | Clear auth cookie |

---

## SQLite: The Database

### What is SQLite?

Most databases (PostgreSQL, MySQL) are separate programs that run alongside your app. SQLite is different — it's a database stored as a single file. No separate server needed. You just read and write to a file.

**Pros:** Simple, fast for reads, zero setup, perfect for small-to-medium apps.
**Cons:** Only one writer at a time, doesn't scale to millions of users.

For our use case (a small team analyzing auction data), SQLite is perfect.

### Our two database files

#### 1. `auction_data.db` — The auction listings

This is the main data. The crawler fills it, the app reads it.

**Tables:**

| Table | What's in it | Who writes | Who reads |
|-------|-------------|-----------|----------|
| `auction_list` | Raw crawler output (English column names) | Python crawler | Nobody directly |
| `auction_list_cleaned` | Processed data (Korean column names) | `sqlite_cleaning.py` | The web app |

**Why two tables?** The raw data from the court API has English column names like `srnSaNo` and `gamevalAmt`. The cleaning step translates these to Korean: `사건번호` and `감정평가액`. The web app only reads the cleaned table.

**Key columns in `auction_list_cleaned`:**

| Column | Meaning | Example |
|--------|---------|---------|
| 사건번호 | Case number | 2024타경12345 |
| 물건종류 | Property type | 토지, 건물 |
| 주소 | Address | 서울 강남구 역삼동 123 |
| 감정평가액 | Appraised value | 500,000,000 |
| 최저매각가격 | Minimum bid price | 350,000,000 |
| % | Price ratio (min/appraised) | 70 |
| 포함/저촉/접합 | Facility overlap type | 포함, 저촉, 접합 |
| PNU | Parcel Number (land ID) | 1168010100101230000 |
| 공시지가(원/㎡) | Official land price per sqm | 5,200,000 |
| 최저가/공시지가비율 | Min price / official price | 0.45 |
| 시설경과연수 | Years since facility designation | 22 |
| 유찰회수 | Number of failed auctions | 2 |

#### 2. `minutes_cache.db` — The cache

This stores API responses so we don't call external APIs every time. Think of it as a notebook where we write down answers to questions we've already asked.

**Tables and their TTLs (time-to-live):**

| Table | What's cached | TTL | Why this TTL |
|-------|--------------|-----|-------------|
| `search_cache` | CLIK search results | 24h | Search results change frequently |
| `detail_cache` | Full meeting transcripts | 7d | Transcripts don't change |
| `embedding_cache` | AI text embeddings | 30d | Computationally expensive to recompute |
| `region_signals` | Keyword signals per area | 7d | Balanced freshness |
| `eum_notices` | Government notices | 7d | Notices updated periodically |
| `eum_permits` | Development permits | 7d | Permits updated periodically |
| `eum_restrictions` | Land use restrictions | 30d | Regulations change slowly |
| `property_scores` | Computed investment scores | 7d | Recomputed by precompute job |
| `property_analysis` | AI-generated analysis text | No expiry | Expensive to generate |
| `luris_cache` | Urban plan facility data | 30d | Facility data changes slowly |

**How TTL works:** Each cached entry has a timestamp. When we look something up, we check: "Is this entry older than the TTL?" If yes, we throw it away and fetch fresh data. If no, we use the cached version.

### How the app reads the database

```typescript
// web/src/lib/db.ts (simplified)
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

// Search across 21 columns with LIKE
function searchAuctions(keyword, page, perPage) {
    const where = SEARCH_COLUMNS
        .map(col => `"${col}" LIKE '%${keyword}%'`)
        .join(" OR ");

    return db.all(`SELECT * FROM auction_list_cleaned WHERE ${where} LIMIT ${perPage} OFFSET ${offset}`);
}
```

**Important:** The auction database is opened as **READONLY**. The web app never writes to it — only the crawler does.

---

## The Crawler: Where Data Comes From

The crawler is a separate Python program that runs daily at 5 AM on the NCP VM. Its job: grab the latest auction listings from the court system and save them to the database.

### The pipeline

```
Step 1: CRAWL                Step 2: ENRICH              Step 3: CLEAN
──────────────               ──────────────              ──────────────
Court auction API    →    VWorld API              →    Column translation
(via Playwright browser)     ├── Land use (포함/저촉/접합)    English → Korean
                             ├── Land price (공시지가)
Get all listings             └── PNU generation
for next 14 days                                        auction_list
                                                         → auction_list_cleaned
```

### Step 1: Crawl (`pipeline.py`)

The court auction website doesn't have a nice API — it's a regular website. So we use **Playwright** (a browser automation tool) to open the website, navigate through pages, and extract the data.

```python
# Simplified flow
browser = await playwright.chromium.launch()
page = await browser.new_page()

# Navigate to auction search
await page.goto("https://...")

# Get total page count
total_pages = extract_page_count(page)

# Fetch each page sequentially (parallel causes IP blocks)
for page_num in range(1, total_pages + 1):
    data = await fetch_page(page, page_num)
    all_items.extend(data)
    await asyncio.sleep(1.5)  # Be nice to the server
```

**Why Playwright instead of simple HTTP requests?** The court website uses JavaScript rendering and session cookies. A regular HTTP client can't handle this — you need a real browser.

### Step 2: Enrich (`storage.py`, `pnu_generator.py`)

For each property, the crawler calls the VWorld API to add extra information:

1. **PNU (Parcel Number)**: Converts the address to a standard land ID
2. **Land use**: Is the property "포함" (fully inside), "저촉" (partially overlapping), or "접합" (adjacent to) a planned government facility?
3. **Land price**: What's the official government-assessed price (공시지가)?
4. **Facility age**: How many years ago was the facility designated?

This enrichment is crucial — the raw auction data doesn't tell you about government plans. VWorld does.

### Step 3: Clean (`sqlite_cleaning.py`)

Translates English column names to Korean and deduplicates:

```python
COLUMN_MAPPING = {
    "srnSaNo": "사건번호",
    "gamevalAmt": "감정평가액",
    "notifyMinmaePrice1": "최저매각가격",
    # ... 30+ mappings
}
```

### Running the crawler

```bash
make crawl        # Runs: crawl → enrich → clean
# or
make db-clean     # Just the cleaning step (if crawler already ran)
```

---

## The Scoring Engine: How Properties Are Ranked

The scoring engine gives each property a score from **0.0 to 1.0** based on five factors. Higher score = better investment signal.

### The five factors

Think of it as a report card with five subjects, each worth a different percentage of your grade:

```
┌─────────────────────────────────────────────────┐
│              TOTAL SCORE (0-1.0)                 │
├───────────────┬─────────┬───────────────────────┤
│ Factor        │ Weight  │ What it measures       │
├───────────────┼─────────┼───────────────────────┤
│ gosi_stage    │  30%    │ How far along is the   │
│               │         │ government project?    │
├───────────────┼─────────┼───────────────────────┤
│ price_        │  25%    │ How cheap is the       │
│ attractiveness│         │ property vs its value? │
├───────────────┼─────────┼───────────────────────┤
│ facility_     │  20%    │ How directly does a    │
│ coverage      │         │ government facility    │
│               │         │ overlap the property?  │
├───────────────┼─────────┼───────────────────────┤
│ timing        │  15%    │ Has the auction failed │
│               │         │ before? (= less        │
│               │         │ competition)           │
├───────────────┼─────────┼───────────────────────┤
│ facility_age  │  10%    │ How long has the       │
│               │         │ facility been planned? │
│               │         │ (older = more likely)  │
└───────────────┴─────────┴───────────────────────┘
```

### Factor 1: gosi_stage (30% weight) — Project progress

Government projects go through stages. The further along, the more likely compensation will happen.

| Stage | What it means | Score |
|-------|--------------|-------|
| 0 | No government notice found | 0.0 |
| 1 | 결정고시 — Project decided/announced | 0.3 |
| 2 | 실시계획 — Implementation plan approved | 0.5 |
| 3 | 사업인정 — Project officially recognized | 0.8 |
| 4 | 보상 — Compensation actively happening | 1.0 |

**This has the highest weight (30%)** because it's the strongest signal. A property at stage 4 (compensation already happening) is almost guaranteed money.

### Factor 2: price_attractiveness (25% weight) — How cheap is it?

Compares the auction's minimum bid price against the official land value (공시지가).

| Min price / Official price | Score | Meaning |
|---------------------------|-------|---------|
| 50% or less | 1.0 | Incredible deal |
| 51-70% | 0.7 | Great deal |
| 71-90% | 0.4 | Decent deal |
| 91-120% | 0.1 | Fair price |
| Over 120% | 0.0 | Overpriced |

**Example:** A property with official land value of 1억 (100M KRW) being auctioned for 4,500만 (45M KRW) has a ratio of 0.45 → score 1.0.

### Factor 3: facility_coverage (20% weight) — Overlap with government plans

How directly is the property affected by the planned government facility?

| Overlap type | Korean | Score | Meaning |
|-------------|--------|-------|---------|
| Fully inside | 포함 | 1.0 | Property is completely within the planned facility area |
| Partially overlapping | 저촉 | 0.7 | Part of the property overlaps |
| Adjacent | 접합 | 0.3 | Property touches the facility area |

### Factor 4: timing (15% weight) — Failed auctions

When an auction fails (nobody bids), it's re-listed at a lower price. Properties with multiple failed auctions (유찰) are cheaper and have less competition.

| Failed auctions | Score |
|----------------|-------|
| 0 | 0.0 |
| 1 | 0.15 |
| 2 | 0.30 |
| 3 | 0.45 |
| 4+ | 0.60 (capped) |

### Factor 5: facility_age (10% weight) — How old is the plan?

Government facilities that were designated long ago but never built are more likely to trigger compensation — the government has to act eventually.

| Years since designation | Score |
|------------------------|-------|
| 18+ years | 1.0 |
| 15-17 years | 0.8 |
| 10-14 years | 0.5 |
| 5-9 years | 0.2 |
| 0-4 years | 0.1 |

### How the total score is calculated

```
total = (facility_coverage × 0.20)
      + (facility_age × 0.10)
      + (gosi_stage × 0.30)
      + (price_attractiveness × 0.25)
      + (timing × 0.15)
```

**Example:** A property with 포함 (1.0), 22 years old (1.0), stage 3 (0.8), ratio 0.45 (1.0), 2 유찰 (0.3):
```
= (1.0 × 0.20) + (1.0 × 0.10) + (0.8 × 0.30) + (1.0 × 0.25) + (0.3 × 0.15)
= 0.20 + 0.10 + 0.24 + 0.25 + 0.045
= 0.835 ← Very strong investment signal
```

### When does scoring happen?

Scoring is **not real-time**. It runs as a **background batch job** triggered by calling:

```bash
curl -H "Authorization: Bearer <PRECOMPUTE_SECRET>" \
  -X POST https://applemango.fly.dev/api/signal-top/precompute
```

This processes ALL properties (takes several minutes), then saves scores to the cache database.

---

## External APIs: The Data Sources

The app talks to five external APIs. Think of them as specialized databases run by different organizations.

### API Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     OUR APP (Next.js)                        │
│                                                              │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐     │
│  │ EUM  │  │LURIS │  │ CLIK │  │VWorld│  │ Gemini   │     │
│  │고시/인허가│ │시설정보│  │회의록 │  │토지정보│  │AI 분석  │     │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └────┬─────┘     │
└─────┼─────────┼─────────┼─────────┼────────────┼────────────┘
      │         │         │         │            │
      ▼         ▼         ▼         ▼            ▼
   eum.go.kr  data.go.kr  nanet.go.kr  vworld.kr  google AI
   Gov notices  Urban plan  Council    Land use   Text analysis
   Dev permits  facilities  minutes    Land price  Embeddings
```

### 1. EUM (토지이음) — Government notices and permits

**What:** The official land information portal. Tells you about government construction plans, compensation notices, and development permits.

**Endpoints:**
| Endpoint | Returns | Used for |
|----------|---------|---------|
| `arMapList` | Government notices (고시정보) | Finding compensation signals (stage 1-4) |
| `isDevList` | Development permits (인허가) | Additional signal data |
| `arLandUseInfo` | Land use restrictions | Understanding what can be built |

**Auth:** API key + IP whitelisting (goes through our NCP proxy)
**Cache:** 7 days for notices/permits, 30 days for restrictions

### 2. LURIS — Urban plan facilities

**What:** Information about urban planning facilities (도시계획시설) — roads, parks, schools planned by the government.

**What it tells us:** What facilities are planned near/on a property, and what activities are allowed or prohibited on the land.

**Auth:** API key
**Cache:** 30 days

### 3. CLIK (회의록) — Council meeting minutes

**What:** Searchable database of all local council meeting transcripts. If a council discussed a road project in your area, it's in here.

**What it tells us:** Whether local politicians are actively discussing development projects that could lead to compensation.

**Auth:** API key
**Cache:** 24 hours for searches, 7 days for transcripts

### 4. VWorld — Land use and price data

**What:** Government geographic information system. Provides official land data.

**What it tells us:**
- PNU (standard land parcel ID) for any address
- Whether land overlaps with planned facilities (포함/저촉/접합)
- Official land price (공시지가) — what the government says the land is worth

**Auth:** API key
**Used by:** The crawler (during enrichment), not the web app directly

### 5. Gemini — AI text analysis

**What:** Google's AI model. We use it for:
- **Query parsing:** Understanding what the user is searching for
- **Text embeddings:** Converting text to numbers for similarity search
- **Summarization:** Writing human-readable analysis of properties

**Auth:** API key
**Cache:** Embeddings cached 30 days, analysis cached indefinitely

---

## Caching: Why We Don't Call APIs Every Time

External API calls are:
- **Slow** (100-500ms each, some APIs much slower)
- **Rate-limited** (you can only call them N times per minute)
- **Expensive** (Gemini charges per token)

So we cache everything. The first time we look up notices for area code `11680`, it takes a real API call. The next time (within 7 days), we just read the answer from our SQLite cache.

### How caching works in practice

```
Request: "Get EUM notices for area 11680"

Step 1: Check cache
  → SELECT * FROM eum_notices WHERE area_cd = '11680' AND age < 7 days
  → Found? Return cached data. Done.

Step 2: Cache miss — call the real API
  → GET https://api.eum.go.kr/.../arMapList?areaCd=11680
  → Got data back

Step 3: Save to cache for next time
  → INSERT INTO eum_notices (area_cd, data, cached_at) VALUES ('11680', ..., NOW())

Step 4: Return data
```

### The precompute job and caching

The `/api/signal-top/precompute` endpoint pre-fetches and caches data for ALL properties at once. This is much more efficient than caching on-demand:

1. Loads all 500+ properties
2. Groups them by area code (PNU first 5 digits)
3. Fetches EUM data once per area code (not once per property)
4. Calculates all scores
5. Saves everything to `property_scores`

After precompute runs, the 투자시그널 tab loads instantly because all data is pre-cached.

---

## Authentication: Who Can Use the App

The app requires login. Here's how it works:

### The login flow

```
1. User enters username + password
2. Browser sends POST /api/login { username, password }
3. Server hashes the password with SHA-256
4. Compares hash against stored hash in VALID_USERS env var
5. If match → creates a JWT token, sets it as a cookie
6. Browser includes the cookie on every subsequent request
7. Middleware checks the cookie on every /api/* request
```

### What is a JWT?

A **JWT (JSON Web Token)** is a small piece of encoded text that proves who you are. Think of it as a wristband at a concert — once you show your ticket (password) at the entrance, you get a wristband (JWT) that lets you walk around freely for the rest of the event.

The JWT contains:
- **Who you are** (username, role)
- **When it expires** (8 hours after login)
- **A signature** (proves it wasn't tampered with)

### The middleware: the bouncer

```typescript
// middleware.ts (simplified)
export function middleware(request) {
    // These don't need auth
    if (request.path === "/api/login") return next();
    if (request.path === "/api/signal-top/precompute") return next(); // uses its own auth

    // Everything else needs a valid JWT cookie
    const token = request.cookies.get("authToken");
    if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

    return next(); // Allowed
}
```

The middleware runs **before** every API request. No valid cookie? 401 Unauthorized. The precompute endpoint is an exception — it uses a separate bearer token (`PRECOMPUTE_SECRET`) because it's called by scripts, not browsers.

---

## Server-Sent Events: Real-Time Progress

Some operations take a long time (searching council minutes, analyzing properties). Instead of making the user wait for one big response, we stream results as they happen.

### What is SSE?

**Server-Sent Events (SSE)** is a way for the server to push updates to the browser over a single HTTP connection. Think of it as a live radio broadcast — you tune in once, and the server keeps sending updates.

```
Browser                         Server
───────                         ──────
POST /api/minutes-search  →
                            ←  event: progress (10%)
                            ←  event: progress (30%)
                            ←  event: partial_result (found 3 minutes)
                            ←  event: progress (70%)
                            ←  event: done (final results)
Connection closes
```

### How it looks in code

```typescript
// Server side (simplified)
export async function POST(request) {
    const stream = new ReadableStream({
        async start(controller) {
            // Send progress update
            controller.enqueue("event: progress\ndata: {\"percent\": 10}\n\n");

            // Do some work...
            const results = await searchMinutes(query);

            // Send results
            controller.enqueue("event: done\ndata: " + JSON.stringify(results) + "\n\n");
            controller.close();
        }
    });

    return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" }
    });
}
```

### Where we use SSE

| Endpoint | What it streams |
|----------|----------------|
| `POST /api/minutes-search` | Search progress, partial results, AI summaries |
| `POST /api/auction-signals` | Signal detection progress, facility lookups, analysis |

---

## React Components: How the UI Is Built

### What is a component?

A component is a reusable piece of UI. Like LEGO blocks — you build small pieces and combine them into bigger structures.

```
AuctionPageClient (the whole page)
├── Tab buttons (경매물건 | 투자시그널 | 회의록)
├── AuctionSearch (search bar)
├── AuctionTable (the data table)
│   ├── Header row (column names)
│   └── AuctionTableRow × N (one per property)
│       └── PropertySignals (expandable detail panel)
├── SignalTopTab (scored properties view)
└── Pagination (page navigation)
```

### Client vs Server components

Next.js has two types of components:

| Type | Runs where | Can do | Can't do |
|------|-----------|--------|----------|
| Server Component | Server only | Read files, query DB | Use React hooks (useState, useEffect) |
| Client Component | Browser | Handle clicks, manage state | Query DB directly |

Client components start with `"use client"` at the top of the file. Most of our components are client components because they need interactivity (clicking tabs, expanding rows, typing in search).

### Dynamic imports: loading tabs on demand

```typescript
const SignalTopTab = dynamic(() => import("./SignalTopTab"), { ssr: false });
const MinutesSearchPage = dynamic(() => import("./MinutesSearchPage"), { ssr: false });
```

`dynamic()` means "don't load this code until it's needed." The 투자시그널 tab code isn't downloaded until the user clicks on that tab. This makes the initial page load faster.

`ssr: false` means "don't try to render this on the server." These components use browser-only features and should only run in the browser.

---

## TypeScript: Why Types Matter

TypeScript is JavaScript with **types** — labels that describe what shape your data has.

### Why we use it

Without types, you might write:

```javascript
// Is item.price a number? A string? Does it even exist?
const total = item.price * item.area;
// This might crash at runtime if price is "N/A"
```

With types:

```typescript
interface AuctionItem {
    사건번호: string;
    감정평가액: number;
    최저매각가격: number;
    면적: number;
    // ... every column is defined
}

const total = item.감정평가액 * item.면적;
// TypeScript checks this at compile time — no surprises at runtime
```

### Our main type: AuctionItem

Defined in `web/src/types/auction.ts`, this describes every column in the auction data. It's used everywhere — API responses, components, scoring functions — to make sure everyone agrees on the data shape.

The file also defines:
- `VISIBLE_COLUMNS` — which columns show in the table
- `FROZEN_COLUMNS` — which columns stay visible when scrolling horizontally
- `COLUMN_WIDTHS` — pixel width of each column

---

## The Complete Data Journey

Here's how data flows from start to finish, through every layer:

```
DAY 1: CRAWL (5 AM, NCP VM)
═══════════════════════════
Court website → Playwright crawler → Raw auction data
    → VWorld API → PNU + land use + land price enrichment
    → SQLite auction_list (raw)
    → sqlite_cleaning.py → auction_list_cleaned (Korean)
    → Database file: auction_data.db

DAY 1: PRECOMPUTE (manual trigger)
═══════════════════════════════════
POST /api/signal-top/precompute
    → Load all properties from auction_list_cleaned
    → For each unique area code:
        → Fetch EUM notices (via NCP proxy) → cache
        → Fetch EUM permits (via NCP proxy) → cache
        → Fetch EUM restrictions (via NCP proxy) → cache
    → For each property:
        → Match gosi notices to property's dong
        → Look up facility coverage (포함/저촉/접합)
        → Calculate 5-factor score
    → Save all scores to property_scores table
    → Detect hot zones (stage 3-4 areas)

DAY 1+: USER BROWSING
═════════════════════
User opens app → Login → JWT cookie set

Tab 1 (경매물건):
    → GET /api/auction-list → SQLite query → table rows

Tab 2 (투자시그널):
    → GET /api/signal-top → Read property_scores cache → ranked list
    → User clicks property → GET /api/signal-top/analysis → AI markdown

Tab 3 (회의록):
    → User types query → POST /api/minutes-search (SSE)
    → CLIK API search → fetch transcripts → Gemini analysis → stream results
```

---

## Docker: Packaging the App

### What is Docker?

Docker packages your app and everything it needs (Node.js, dependencies) into a **container** — a portable box that runs the same way everywhere.

Without Docker: "It works on my machine but not on the server" (different Node.js version, missing packages, etc.)

With Docker: "It runs the same everywhere because the whole environment is in the box."

### Our Dockerfile (simplified)

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
COPY . .
RUN npm install && npm run build

# Stage 2: Run
FROM node:22-alpine
COPY --from=builder /app/.next .next
COPY --from=builder /app/node_modules node_modules

# Create a place for the databases
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.js"]
```

**Multi-stage build:** Stage 1 installs all dependencies and compiles the app. Stage 2 copies only the compiled output — smaller final image, faster deploys.

**The `/data` volume:** In production (Fly.io), the databases live at `/data/auction_data.db` and `/data/minutes_cache.db`. This directory is a **persistent volume** — it survives app restarts and deploys.

---

## Key Files Reference

### If you want to change...

| What | File(s) to edit |
|------|----------------|
| Scoring weights or thresholds | `web/src/lib/scoring/config.ts` |
| How scores are calculated | `web/src/lib/scoring/engine.ts` |
| Which columns show in the table | `web/src/types/auction.ts` (VISIBLE_COLUMNS) |
| Column widths | `web/src/types/auction.ts` (COLUMN_WIDTHS) |
| How EUM API is called | `web/src/lib/eum/client.ts` |
| Cache TTLs | `web/src/lib/minutes/cache/db.ts` (TTL constants) |
| Auth settings (users, passwords) | `VALID_USERS` environment variable |
| What the crawler collects | `crawler/src/pipeline.py` |
| How raw data → cleaned data | `crawler/src/models.py` (COLUMN_MAPPING) |
| API route behavior | `web/src/app/api/<endpoint>/route.ts` |
| UI layout and components | `web/src/components/auction/` |

### Common commands

```bash
make dev          # Start the app locally (http://localhost:3000)
make crawl        # Run the crawler
make db-clean     # Re-run the cleaning step
make deploy       # Deploy to Fly.io
make test         # Run tests
make typecheck    # Check for TypeScript errors
make lint         # Check code style
```
