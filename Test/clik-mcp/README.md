# CLIK 지방의회 회의록 MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that wraps the **CLIK (지방의회통합정보시스템) Open API**, enabling AI agents (Claude, etc.) to search and read Korean local council meeting minutes (회의록) in real-time.

## Table of Contents

- [Background](#background)
- [Architecture Overview](#architecture-overview)
- [Natural Language Query Service (CLI)](#natural-language-query-service-cli)
- [Project Structure](#project-structure)
- [CLIK Open API Reference](#clik-open-api-reference)
  - [Endpoint](#endpoint)
  - [Authentication](#authentication)
  - [Search (List) API](#search-list-api)
  - [Detail API](#detail-api)
  - [Response Format Quirks](#response-format-quirks)
  - [Rate Limits](#rate-limits)
- [MCP Tools](#mcp-tools)
  - [search_minutes](#search_minutes)
  - [get_minute_detail](#get_minute_detail)
- [Source Files Detailed Breakdown](#source-files-detailed-breakdown)
  - [src/types.ts](#srctypests)
  - [src/clik-client.ts](#srcclik-clientts)
  - [src/index.ts](#srcindexts)
  - [src/test-api.ts](#srctest-apits)
- [Setup & Running](#setup--running)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Build](#build)
  - [Run API Test](#run-api-test)
  - [Run as MCP Server](#run-as-mcp-server)
  - [Claude Desktop Integration](#claude-desktop-integration)
- [Example Usage Flow](#example-usage-flow)
- [Known Council Codes](#known-council-codes)
- [Known Limitations & Quirks](#known-limitations--quirks)
- [Future Work / Extension Ideas](#future-work--extension-ideas)
- [Troubleshooting](#troubleshooting)

---

## Background

The **CLIK** system (https://clik.nanet.go.kr) is operated by the **Korean National Assembly Library** (국회도서관). It aggregates meeting minutes from all local councils (지방의회) across South Korea. It provides an Open API for programmatic access to this data.

This project wraps that API into an MCP server so that AI agents like Claude can:
1. **Search** council minutes by keyword (e.g. "석지제", "재난", "환경")
2. **Read** the full transcript of a specific meeting

The initial test target is **서산시의회 (Seosan City Council)**, council code `041009`.

---

## Architecture Overview

```
┌─────────────┐     stdio      ┌──────────────────┐     HTTPS     ┌──────────────┐
│  AI Agent   │ ◄────────────► │  clik-mcp server │ ────────────► │  CLIK API    │
│ (Claude etc)│    MCP JSON    │  (Node.js/TS)    │   REST/JSON   │  (nanet.go.kr)│
└─────────────┘                └──────────────────┘               └──────────────┘
```

- **Transport:** StdioServerTransport (stdin/stdout JSON-RPC)
- **HTTP Client:** Axios with 30s timeout
- **API Format:** JSON (the API also supports XML, but we use JSON exclusively)

---

## Natural Language Query Service (CLI)

> **New Feature**: Query council minutes using natural language!

This project now includes a **CLI tool** that uses **Google Gemini** to understand your questions and summarize answers.

### How it works
1. **Parses** your question (e.g. "서산시에서 석지제 언급해?") to extract `district` ("서산시") and `keyword` ("석지제").
2. **Maps** the district name to the official CLIK `rasmblyId` (e.g. `041009`) using a built-in mapping of ~140 councils.
3. **Searches** the CLIK API for the keyword.
4. **Summarizes** the search results using Gemini to answer your question.

### Usage
```bash
# Add GEMINI_API_KEY to your .env file first!
npx tsx src/run-service.ts "서산시에서 최근 석지제 사업 관련 언급이 있어?"
```

---

## Project Structure

```
test/clik-mcp/
├── package.json          # Project config, dependencies, scripts
├── tsconfig.json         # TypeScript config (ES2022, Node16 modules)
├── .env                  # CLIK_API_KEY (not committed to git)
├── src/
│   ├── types.ts          # TypeScript interfaces for API request/response
│   ├── clik-client.ts    # ClikClient class — API calls + HTML cleaning
│   ├── index.ts          # MCP server entry point — tool registration
│   ├── test-api.ts       # Integration test script
│   ├── llm.ts            # LLM integration (Gemini) for parsing & summarizing
│   ├── workflow.ts       # Service orchestration (Parse -> Map -> Search -> Summarize)
│   ├── run-service.ts    # CLI entry point for NL query
│   └── data/
│       └── councils.ts   # Static mapping of council names to codes
├── dist/                 # Compiled JS output (after `npm run build`)
└── node_modules/
```

---

## CLIK Open API Reference

> **Official documentation:** https://clik.nanet.go.kr/potal/guide/resourceCenter.do
> (May require navigating through Korean UI; details below were extracted 2026-02-18.)

### Endpoint

```
https://clik.nanet.go.kr/openapi/minutes.do
```

Single endpoint for all operations; behavior is controlled by the `displayType` parameter.

### Authentication

- **Parameter:** `key` (query string)
- **API Key:** Issued from CLIK website (https://clik.nanet.go.kr → 이용안내 → Open API → 인증키 신청)
- **Environment Variable:** `CLIK_API_KEY`

### Search (List) API

`displayType=list`

| Parameter | Required | Type | Description |
|---|---|---|---|
| `key` | ✅ | string | API key |
| `type` | ✅ | string | Response format: `json` or `xml` |
| `displayType` | ✅ | string | Must be `list` |
| `startCount` | ✅ | integer | Pagination offset (0-based) |
| `listCount` | ✅ | integer | Results per page (max 100) |
| `searchType` | ✅ | string | Search field — see below |
| `searchKeyword` | ✅ | string | Search keyword (URL-encoded) |
| `rasmblyId` | ❌ | string | Council code (e.g. `041009`). Omit to search all councils |

**searchType values:**
| Value | Meaning |
|---|---|
| `ALL` | 전체 (all fields) |
| `MTR_SJ` | 제목 (title/subject) |
| `MINTS_HTML` | 내용 (content/transcript) |
| `RASMBLY_NM` | 의회명 (council name) |
| `PRMPST_CMIT_NM` | 위원회명 (committee name) |

**Example request:**
```
GET https://clik.nanet.go.kr/openapi/minutes.do?key=YOUR_KEY&type=json&displayType=list&startCount=0&listCount=5&searchType=ALL&searchKeyword=석지제&rasmblyId=041009
```

**Response structure (JSON):**
```json
[
  {
    "SERVICE": "minutes",
    "RESULT_CODE": "SUCCESS",
    "RESULT_MESSAGE": "정상 처리되었습니다.",
    "TOTAL_COUNT": 15,
    "LIST_COUNT": 5,
    "LIST": [
      {
        "ROW": {
          "DOCID": "CLIKC1211423791937061",
          "RASMBLY_SESN": "297",
          "RASMBLY_ID": "041009",
          "MTG_DE": "20240715",
          "RASMBLY_NM": "충청남도 서산시의회",
          "RASMBLY_NUMPR": "9",
          "MINTS_ODR": "1",
          "MTGNM": "본회의"
        }
      },
      { "ROW": { ... } }
    ]
  }
]
```

**Key response fields per ROW:**
| Field | Description |
|---|---|
| `DOCID` | Unique document ID (used for detail lookup) |
| `RASMBLY_ID` | Council code |
| `RASMBLY_NM` | Council name (e.g. "충청남도 서산시의회") |
| `MTGNM` | Meeting name (e.g. "본회의", "상임위원회") |
| `MTG_DE` | Meeting date in `YYYYMMDD` format |
| `RASMBLY_NUMPR` | Council term number (대수) |
| `RASMBLY_SESN` | Session number (회차) |
| `MINTS_ODR` | Meeting sequence number (차수) |
| `PRMPST_CMIT_NM` | Committee name (optional) |
| `MTR_SJ` | Subject/agenda title (optional, sometimes absent in list results) |

### Detail API

`displayType=detail`

| Parameter | Required | Type | Description |
|---|---|---|---|
| `key` | ✅ | string | API key |
| `type` | ✅ | string | `json` or `xml` |
| `displayType` | ✅ | string | Must be `detail` |
| `docid` | ✅ | string | Document ID from search results |

**Example request:**
```
GET https://clik.nanet.go.kr/openapi/minutes.do?key=YOUR_KEY&type=json&displayType=detail&docid=CLIKC1211423791937061
```

**Response structure (JSON) — ⚠️ DIFFERENT from list:**
```json
[
  {
    "SERVICE": "minutes",
    "RESULT_CODE": "SUCCESS",
    "RESULT_MESSAGE": "정상 처리되었습니다.",
    "DOCID": "CLIKC1211423791937061",
    "MTR_SJ": "1. 제297회 서산시의회 임시회 회기결정의 건 ...",
    "RASMBLY_SESN": "297",
    "RASMBLY_ID": "041009",
    "MTG_DE": "20240715",
    "RASMBLY_NM": "충청남도 서산시의회",
    "RASMBLY_NUMPR": "9",
    "MINTS_ODR": "1",
    "MINTS_HTML": "<div id=\"top\">... (full HTML page with transcript) ...</div>",
    "ORGINL_FILE_URL": "",
    "MTGNM": "본회의"
  }
]
```

### Response Format Quirks

> **⚠️ CRITICAL for implementers — the list and detail endpoints return DIFFERENT JSON structures:**

1. **Both** responses are wrapped in a top-level JSON **array** `[{ ... }]` (always a single-element array).
2. **List response:** Results are in `LIST` property as `Array<{ ROW: T }>`.
   ```
   response.data[0].LIST[i].ROW  →  MinuteListItem
   ```
3. **Detail response:** Fields are **directly** on the response object. There is **NO** `LIST` or `ROW` wrapper.
   ```
   response.data[0]  →  { DOCID, MINTS_HTML, RASMBLY_NM, ... }
   ```
4. The `MINTS_HTML` field contains the **entire HTML page** including search forms, navigation, fonts, stylesheets — not just the transcript. It requires significant HTML cleaning to extract readable content.
5. The HTML content in the JSON is double-escaped: tabs are `\t`, newlines are `\n`, forward slashes are `\/`.

### Rate Limits

- **Max results per API call:** 100 (`listCount` max)
- **Daily call limit:** 1,000 calls per API key
- **Timeout:** We use 30 seconds

---

## MCP Tools

### search_minutes

**Description:** 지방의회 회의록을 키워드로 검색합니다. Search local council meeting minutes by keyword.

**Parameters (Zod Schema):**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `keyword` | string | ✅ | — | 검색어 (search keyword) |
| `councilCode` | string | ❌ | all councils | 의회 기관코드 (e.g. `041009` for 서산시의회) |
| `searchType` | enum | ❌ | `ALL` | Search field: `ALL`, `MTR_SJ`, `MINTS_HTML`, `RASMBLY_NM`, `PRMPST_CMIT_NM` |
| `startCount` | integer | ❌ | `0` | Pagination offset (0-based) |
| `listCount` | integer | ❌ | `10` | Results per page (1–100) |

**Returns:** Markdown-formatted list of matching minutes with meeting name, date, council, committee, and document ID.

### get_minute_detail

**Description:** 특정 회의록의 상세 발언 내용(본문)을 가져옵니다. Get the full transcript of a specific council minute by document ID.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `docid` | string | ✅ | 회의록 문서 ID (`search_minutes` 결과에서 얻을 수 있음) |

**Returns:** Markdown header with metadata + cleaned transcript text. Truncated at 50,000 characters to prevent context overflow.

---

## Source Files Detailed Breakdown

### src/types.ts

TypeScript interfaces for the CLIK API, **verified against live API responses** (not just documentation).

- `SearchType` — union type for the `searchType` parameter (`ALL`, `MTR_SJ`, etc.)
- `SearchMinutesParams` — input parameters for search
- `GetMinuteDetailParams` — input parameters for detail
- `MinuteListItem` — shape of each search result row
  - Some fields (`RASMBLY_SESN`, `MINTS_ODR`, `PRMPST_CMIT_NM`, `MTR_SJ`) are **optional** because they're not always present in list responses
- `MinuteDetail extends MinuteListItem` — adds `MINTS_HTML` (transcript)
- `ClikApiResponseItem<T>` — list response wrapper with `LIST: Array<{ ROW: T }>`
- `ClikApiResponse<T>` — top-level array wrapper `ClikApiResponseItem<T>[]`

### src/clik-client.ts

The `ClikClient` class encapsulates all API communication.

**Key methods:**

- `searchMinutes(params)` — calls the list endpoint, unwraps `LIST[].ROW`, returns `{ totalCount, items }`.
- `getMinuteDetail(docid)` — calls the detail endpoint, handles the **different response format** (fields directly on wrapper object, no `LIST`/`ROW`), returns cleaned `MinuteDetail`.
- `stripHtml(html)` (private) — the HTML cleaner. This is the most complex part:

**HTML Cleaning Pipeline (`stripHtml`):**

1. **Unescape** JSON-escaped sequences (`\t`, `\n`, `\/`)
2. **Insert structure markers** before stripping tags:
   - `◆` for speaker names (from `class="line_name"`)
   - `⏰` for timestamps (from `class="time_icon"`)
   - `【` for agenda items (from `class="matter_icon"`)
   - `▶` for attendance sections (from `class="atd_title"`)
3. **Trim page template** — finds the first content marker (`◆`, `⏰`, or `【`) and discards everything before it (removes search forms, navigation, stylesheets)
4. **Strip remaining HTML tags** and decode entities (`&nbsp;`, `&amp;`, etc.)
5. **Normalize whitespace**

### src/index.ts

MCP server entry point using `@modelcontextprotocol/sdk`.

- Reads `CLIK_API_KEY` from environment (hard exits if missing)
- Creates `ClikClient` instance
- Registers two tools with Zod schemas for input validation
- **search_minutes tool:** Formats results as Markdown with numbered headings
- **get_minute_detail tool:** Adds Markdown header with metadata, truncates transcript at 50,000 chars
- Both tools catch errors and return them as `isError: true` MCP responses
- Uses `StdioServerTransport` for communication
- `formatDate()` helper converts `YYYYMMDD` → `YYYY-MM-DD`

### src/test-api.ts

Standalone integration test that validates both API endpoints.

- Accepts optional CLI arguments: `npx tsx src/test-api.ts [keyword] [councilCode]`
- Defaults to keyword `석지제`, council `041009` (서산시의회)
- Runs search → prints results → fetches first detail → prints preview

---

## Setup & Running

### Prerequisites

- **Node.js** ≥ 18 (tested with v25.6.0)
- **npm**
- **CLIK API Key** — issue one at https://clik.nanet.go.kr → 이용안내 → Open API → 인증키 신청
- **Gemini API Key** — for Natural Language Query Service (Google Gemini)

### Install

```bash
cd test/clik-mcp
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript from `src/` to `dist/` via `tsc`.

### Run API Test

```bash
# Uses defaults: keyword="석지제", council="041009"
CLIK_API_KEY=YOUR_KEY npm run test-api

# With custom keyword and council
CLIK_API_KEY=YOUR_KEY npx tsx src/test-api.ts "환경" "041009"
```

**Expected output (example):**
```
=== CLIK API Integration Test ===

1) Searching 041009 for keyword "석지제"...

   Total results: 15
   Returned items: 5

   • [2024-07-15] 본회의
     의회: 충청남도 서산시의회 | DOCID: CLIKC1211423791937061
   ...

2) Fetching detail for DOCID: CLIKC1211423791937061...

   제목: 1. 제297회 서산시의회 임시회 회기결정의 건 ...
   의회: 충청남도 서산시의회
   본문 길이: 11,908 chars

--- 본문 미리보기 (1000자) ---

⏰ 10시 10분 개의

◆ 의장조동식
의석을 정돈하여 주시기 바랍니다.
성원이 되었으므로 제297회 서산시의회 임시회 제1차 본회의를 개의하겠습니다.
...
```

### Run as MCP Server

```bash
# Build first
npm run build

# Run
CLIK_API_KEY=YOUR_KEY npm start

# Or for development (no build step)
CLIK_API_KEY=YOUR_KEY npm run dev
```

The server communicates over stdin/stdout using the MCP JSON-RPC protocol.

### Claude Desktop Integration

Add to your Claude Desktop MCP configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "clik-minutes": {
      "command": "node",
      "args": ["/Users/soonyoung/Desktop/auction-project/test/clik-mcp/dist/index.js"],
      "env": {
        "CLIK_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

After saving, restart Claude Desktop. You should see the `search_minutes` and `get_minute_detail` tools available.

---

## Example Usage Flow

A typical conversational flow with an AI agent connected to this MCP server:

```
User: "서산시에서 최근 석지제 관련 언급이 있어?"

→ Agent calls search_minutes(keyword="석지제", councilCode="041009")
→ Returns 15 results, most recent from 2024-07-15

→ Agent calls get_minute_detail(docid="CLIKC1211423791937061")
→ Returns full transcript of that meeting

→ Agent summarizes: "2024년 7월 15일 본회의에서 문수기 의원이 석지제 관련 발언을 했습니다..."
```

---

## Known Council Codes

| Code | Council Name |
|---|---|
| `041009` | 충청남도 서산시의회 (Seosan) |

> Full council code list is available at: https://clik.nanet.go.kr/potal/guide/resourceCenter.do → "목록 보기" link.
> You can also search without a council code to search across all councils.

---

## Known Limitations & Quirks

1. **No date filtering.** The CLIK Open API does **not** officially support `startDate`/`endDate` parameters. Results are sorted by meeting date **descending** (most recent first) by default. The web search page has hidden form fields `BEGIN_MTG_DE` and `END_MTG_DE` but these are undocumented for the Open API and may not work.

2. **Different response formats.** The list and detail endpoints return **structurally different** JSON responses (see [Response Format Quirks](#response-format-quirks)). This is the single most important gotcha for implementers.

3. **HTML transcript content.** `MINTS_HTML` in the detail response is a **full HTML page** with search forms, navigation, font declarations, etc. — not just the meeting transcript. The `stripHtml()` method in `clik-client.ts` handles this by using CSS class-based markers to identify actual content, but it may need tuning for different council formats.

4. **Transcript truncation.** The MCP `get_minute_detail` tool truncates transcripts at 50,000 characters to avoid overwhelming AI context windows. Some meetings may exceed this.

5. **Rate limiting.** 1,000 API calls per day per key. Each search or detail fetch counts as one call.

6. **`MTR_SJ` (subject) is inconsistent.** In list results, `MTR_SJ` is often absent — the meeting name (`MTGNM`) is more reliable. In detail results, `MTR_SJ` usually contains the full agenda listing.

7. **Council name includes province.** `RASMBLY_NM` returns the full name including province (e.g. "충청남도 서산시의회"), not just "서산시의회".

8. **`zod` comes bundled.** The `@modelcontextprotocol/sdk` package bundles `zod` internally, so there's no separate `zod` dependency in `package.json`. It's imported directly in `index.ts`.

---

## Future Work / Extension Ideas

1. **Add more tools:**
   - `list_councils()` — fetch available council codes dynamically
   - `search_bills()` — CLIK also has a bills (의안) API at the same resource center

2. **Date filtering:** Try `BEGIN_MTG_DE` and `END_MTG_DE` as undocumented params to see if they work with the Open API.

3. **Better HTML parsing:** Use a proper HTML parser (like `cheerio`) instead of regex for more robust transcript extraction.

4. **Caching:** Cache search results and details to reduce API calls (remember the 1,000/day limit).

5. **Pagination helper:** Add a tool that automatically paginates through all results for a given search.

6. **Full-text search within transcript:** After fetching a detail, search within the transcript for specific mentions.

7. **Multi-council support:** Build a lookup table of common council codes so users can search by city name instead of code.

---

## Troubleshooting

**"CLIK API error: NO_RESPONSE"**
- Check that your API key is valid and not expired
- Check network connectivity to `clik.nanet.go.kr`

**"CLIK_API_KEY environment variable is required"**
- Set the environment variable: `export CLIK_API_KEY=your_key_here`

**Build errors**
```bash
rm -rf dist node_modules
npm install
npm run build
```

**Empty search results**
- Try broader keywords
- Try without `councilCode` to search all councils
- Check if the keyword is in the correct encoding (the API handles URL encoding automatically via Axios)

**Garbled transcript text**
- The HTML cleaning is regex-based and may not handle all edge cases
- Check `clik-client.ts` → `stripHtml()` method and add patterns for unhandled HTML structures
