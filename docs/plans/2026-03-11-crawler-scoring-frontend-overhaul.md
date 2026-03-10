# Crawler Fix + Scoring Overhaul + Frontend Improvement Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken crawler pipeline, redesign scoring to prioritize compensation-eligible urban facilities, limit to top 100, exclude housing, and improve frontend UX.

**Architecture:** Three independent workstreams: (1) Fix crawler config so run-crawl.sh step 5 succeeds, (2) Rewrite computeScoreV2 to weight compensation-focused signals and add filtering, (3) Add summary stats, sorting controls, and cleaner card layout to SignalTopTab.

**Tech Stack:** Python 3.11 (crawler), Next.js 16 + TypeScript (web), SQLite, CSS Modules

---

## Task 1: Fix Crawler — Add Missing COUNCIL_API_CONFIG to config.py

**Problem:** `crawler/scripts/index_region_signals.py` line 21 imports `COUNCIL_API_CONFIG` from `config.py`, but config.py has no such key. This causes step 5 of `run-crawl.sh` to crash with `ImportError`.

**Files:**
- Modify: `crawler/config.py`
- Verify: `crawler/scripts/index_region_signals.py` (already correct, just needs config)

**Step 1: Add COUNCIL_API_CONFIG to config.py**

Append after CACHE_CONFIG (line 57) in `crawler/config.py`:

```python
# CLIK 의회 회의록 API 설정
COUNCIL_API_CONFIG: dict[str, Any] = {
    'base_url': 'https://clik.nanet.go.kr/openapi/minutes.do',
    'api_key': os.getenv('CLIK_API_KEY', ''),
}
```

**Step 2: Verify the import works locally**

Run:
```bash
cd crawler && source .venv/bin/activate
python -c "from config import COUNCIL_API_CONFIG; print(COUNCIL_API_CONFIG)"
```
Expected: dict with base_url and api_key (api_key may be empty locally)

**Step 3: Fix run-crawl.sh argument handling**

The script calls: `python scripts/index_region_signals.py "$OUTPUT_DB"` (positional arg)
But the script uses argparse with `--db-path` (keyword arg, default `database/auction.db`).

Fix line 91 in `crawler/deploy/run-crawl.sh`:
```bash
# Before:
python scripts/index_region_signals.py "$OUTPUT_DB" || echo "..."
# After:
python scripts/index_region_signals.py --db-path "$OUTPUT_DB" --cache-path "$MINUTES_CACHE_PATH" || echo "..."
```

**Step 4: Verify run-crawl.sh syntax**

Run: `bash -n crawler/deploy/run-crawl.sh`
Expected: No output (syntax OK)

**Step 5: Commit**

```bash
git add crawler/config.py crawler/deploy/run-crawl.sh
git commit -m "fix: add COUNCIL_API_CONFIG to config.py and fix run-crawl.sh argparse call"
```

---

## Task 2: Scoring — Exclude '주택' Items in Precompute

**Problem:** Items with '주택' in `물건종류` should be excluded entirely from scoring.

**Files:**
- Modify: `web/src/app/api/signal-top/precompute/route.ts` (processAllItems function)

**Step 1: Add housing filter in processAllItems**

After line 241 (`if (!address || !docId) continue;`), add:

```typescript
// Exclude housing items from scoring
const itemType = String(item["물건종류"] || "");
if (itemType.includes("주택")) continue;
```

**Step 2: Commit**

```bash
git add web/src/app/api/signal-top/precompute/route.ts
git commit -m "feat: exclude housing items from signal scoring"
```

---

## Task 3: Scoring — Redesign computeScoreV2 for Compensation Focus

**Problem:** Current scoring gives highest weight to EUM notices (40pt each, uncapped) which inflates scores for areas with many generic notices. User wants focus on 도시계획시설 with 보상대상 (compensation-eligible facilities).

**Files:**
- Modify: `web/src/app/api/signal-top/precompute/route.ts` (computeScoreV2 function)

**Step 1: Rewrite computeScoreV2**

Replace the entire `computeScoreV2` function (lines 47-95) with:

```typescript
function computeScoreV2(
    signals: RegionSignal[],
    facilities: UrbanPlanFacility[],
    notices: CachedEumNotice[],
    permits: CachedEumPermit[],
    restrictions: CachedEumRestriction[],
    pnu: string,
): number {
    let score = 0;

    // === TIER 1: 도시계획시설 (핵심 — 보상대상 여부가 최우선) ===
    // Unexecuted urban plan facilities = compensation eligible
    const unexecuted = facilities.filter(
        (f) => f.executionStatus && f.executionStatus !== "집행완료"
    );
    score += unexecuted.length * 50;   // 미집행 시설 = 보상대상 가능성
    score += (facilities.length - unexecuted.length) * 5; // 집행완료 시설 = 참고용

    // === TIER 2: 보상/수용/편입 시그널 (회의록에서 직접 언급) ===
    let compensationSignal = 0;
    let otherSignal = 0;
    for (const signal of signals) {
        if (["보상", "수용", "편입"].includes(signal.keyword)) {
            compensationSignal += signal.doc_count * 15;
        } else if (["도시계획", "착공"].includes(signal.keyword)) {
            otherSignal += signal.doc_count * 5;
        } else {
            otherSignal += signal.doc_count * 1;
        }
    }
    score += Math.min(compensationSignal, 60);  // 보상 시그널 cap 60
    score += Math.min(otherSignal, 15);          // 기타 시그널 cap 15

    // === TIER 3: EUM 고시 (보상 관련 고시만 고점수) ===
    const compensationNotices = notices.filter((n) =>
        n.title && (n.title.includes("보상") || n.title.includes("수용") ||
        n.title.includes("편입") || n.title.includes("도시계획"))
    );
    const otherNotices = notices.length - compensationNotices.length;
    score += compensationNotices.length * 20;  // 보상 관련 고시
    score += Math.min(otherNotices, 3) * 5;    // 기타 고시 (cap 3건)

    // PNU cross-match bonus
    const pnuPrefix = pnu ? pnu.substring(0, 10) : "";
    if (pnuPrefix) {
        const pnuMatches = notices.filter((n) =>
            n.relatedAddress && n.relatedAddress.length > 0
        );
        score += Math.min(pnuMatches.length, 2) * 15;
    }

    // === TIER 4: 인허가/행위제한 (참고 수준) ===
    score += Math.min(permits.length, 3) * 10;
    score += Math.min(restrictions.length, 3) * 3;

    return score;
}
```

**Key changes:**
- Unexecuted facilities (보상대상): 50pt each (was 10+15=25)
- Compensation signals (보상/수용/편입): 15pt/doc, cap 60 (was 20pt, cap 20)
- Compensation-related notices: 20pt each (was 40pt for ALL notices)
- Generic notices capped at 3 (was uncapped)
- Overall: 도시계획시설 미집행 > 보상시그널 > 보상고시 > 인허가

**Step 2: Commit**

```bash
git add web/src/app/api/signal-top/precompute/route.ts
git commit -m "feat: redesign scoring to prioritize compensation-eligible urban facilities"
```

---

## Task 4: Scoring — Limit Display to Top 100

**Problem:** 700+ items are too heavy. Limit to top 100.

**Files:**
- Modify: `web/src/app/api/signal-top/route.ts`
- Modify: `web/src/lib/minutes/cache.ts` (getPropertyScoreCount)

**Step 1: Cap total count at 100 in the API route**

In `web/src/app/api/signal-top/route.ts`, modify the GET handler:

```typescript
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") || "20", 10)));

    // Cap total results at 100 (top scores only)
    const MAX_RESULTS = 100;
    const offset = (page - 1) * perPage;

    // Don't fetch beyond the cap
    if (offset >= MAX_RESULTS) {
        return Response.json({ data: [], total: MAX_RESULTS, page, perPage });
    }

    const adjustedLimit = Math.min(perPage, MAX_RESULTS - offset);

    try {
        const [items, rawTotal] = await Promise.all([
            getPropertyScores(adjustedLimit, offset),
            getPropertyScoreCount(),
        ]);

        const total = Math.min(rawTotal, MAX_RESULTS);

        const docIds = items.map((i) => i.doc_id);
        const analysisMap = await getPropertyAnalysisBatch(docIds);

        const data = items.map((item) => ({
            ...item,
            signal_keywords: item.signal_keywords ? JSON.parse(item.signal_keywords) : [],
            signal_details: item.signal_details ? JSON.parse(item.signal_details) : [],
            facility_details: item.facility_details ? JSON.parse(item.facility_details) : [],
            notice_details: item.notice_details ? JSON.parse(item.notice_details) : [],
            permit_details: item.permit_details ? JSON.parse(item.permit_details) : [],
            restriction_details: item.restriction_details ? JSON.parse(item.restriction_details) : [],
            auction_data: item.auction_data ? JSON.parse(item.auction_data) : {},
            has_analysis: analysisMap.has(item.doc_id),
        }));

        return Response.json({ data, total, page, perPage });
    } catch (err) {
        console.error("[signal-top] Error:", err);
        return Response.json({ error: "Failed to fetch signal scores" }, { status: 500 });
    }
}
```

**Step 2: Commit**

```bash
git add web/src/app/api/signal-top/route.ts
git commit -m "feat: cap signal-top results to top 100 items"
```

---

## Task 5: Frontend — Improve SignalTopTab with Summary Stats & Sorting

**Problem:** SignalTopTab just shows a plain list. Add a summary bar with stats, filter/sort controls, and score breakdown tooltip.

**Files:**
- Modify: `web/src/components/auction/SignalTopTab.tsx`
- Modify: `web/src/components/auction/SignalTopTab.module.css`

**Step 1: Add sort/filter state and summary stats**

At the top of SignalTopTab function (after existing state declarations), add:

```typescript
type SortKey = "score" | "facility" | "compensation";
const [sortBy, setSortBy] = useState<SortKey>("score");
const [filterCompensation, setFilterCompensation] = useState(false);

// Client-side sort (server already sorts by score, this is for secondary sorts)
const sortedItems = React.useMemo(() => {
    let filtered = [...items];
    if (filterCompensation) {
        filtered = filtered.filter((item) => item.has_compensation === 1 || item.has_unexecuted === 1);
    }
    if (sortBy === "facility") {
        filtered.sort((a, b) => b.facility_count - a.facility_count || b.score - a.score);
    } else if (sortBy === "compensation") {
        filtered.sort((a, b) => (b.has_compensation + b.has_unexecuted) - (a.has_compensation + a.has_unexecuted) || b.score - a.score);
    }
    return filtered;
}, [items, sortBy, filterCompensation]);

// Summary stats
const stats = React.useMemo(() => ({
    total,
    compensationCount: items.filter((i) => i.has_compensation === 1).length,
    unexecutedCount: items.filter((i) => i.has_unexecuted === 1).length,
    avgScore: items.length > 0 ? Math.round(items.reduce((s, i) => s + i.score, 0) / items.length) : 0,
}), [items, total]);
```

**Step 2: Add summary bar and controls to render**

Replace the total count div (`{total}건`) with:

```tsx
{/* Summary stats bar */}
<div className={styles.statsBar}>
    <div className={styles.statItem}>
        <span className={styles.statValue}>{stats.total}</span>
        <span className={styles.statLabel}>전체</span>
    </div>
    <div className={styles.statItem}>
        <span className={styles.statValue} style={{ color: "#dc2626" }}>{stats.compensationCount}</span>
        <span className={styles.statLabel}>보상 시그널</span>
    </div>
    <div className={styles.statItem}>
        <span className={styles.statValue} style={{ color: "#ea580c" }}>{stats.unexecutedCount}</span>
        <span className={styles.statLabel}>미집행 시설</span>
    </div>
    <div className={styles.statItem}>
        <span className={styles.statValue}>{stats.avgScore}</span>
        <span className={styles.statLabel}>평균 점수</span>
    </div>
</div>

{/* Sort/Filter controls */}
<div className={styles.controls}>
    <div className={styles.sortGroup}>
        {(["score", "facility", "compensation"] as SortKey[]).map((key) => (
            <button
                key={key}
                className={`${styles.sortBtn} ${sortBy === key ? styles.sortBtnActive : ""}`}
                onClick={() => setSortBy(key)}
            >
                {key === "score" ? "점수순" : key === "facility" ? "시설순" : "보상순"}
            </button>
        ))}
    </div>
    <button
        className={`${styles.filterBtn} ${filterCompensation ? styles.filterBtnActive : ""}`}
        onClick={() => setFilterCompensation(!filterCompensation)}
    >
        <AlertTriangle size={13} />
        보상대상만
    </button>
</div>
```

**Step 3: Update card iteration to use sortedItems**

Replace `{items.map((item, idx) => {` with `{sortedItems.map((item, idx) => {`

**Step 4: Add score breakdown to card body**

After the signal summary div, add a score breakdown:

```tsx
{/* Score breakdown */}
<div className={styles.scoreBreakdown}>
    {item.facility_count > 0 && (
        <span className={styles.breakdownItem}>
            시설 {item.facility_count}
            {item.has_unexecuted === 1 && <span className={styles.unexecutedDot} />}
        </span>
    )}
    {item.notice_count > 0 && <span className={styles.breakdownItem}>고시 {item.notice_count}</span>}
    {item.permit_count > 0 && <span className={styles.breakdownItem}>인허가 {item.permit_count}</span>}
    {item.signal_count > 0 && <span className={styles.breakdownItem}>회의록 {item.signal_count}</span>}
</div>
```

**Step 5: Add CSS for new components**

Append to `web/src/components/auction/SignalTopTab.module.css`:

```css
/* Summary stats bar */
.statsBar {
    display: flex;
    gap: 24px;
    padding: 12px 16px;
    background: var(--bg-hover);
    border-radius: var(--radius-md);
    margin-bottom: 8px;
}
.statItem {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.statValue {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-main);
    line-height: 1;
}
.statLabel {
    font-size: 11px;
    color: var(--text-muted);
}

/* Sort/Filter controls */
.controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}
.sortGroup {
    display: flex;
    gap: 4px;
}
.sortBtn {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-fast);
}
.sortBtn:hover {
    background: var(--bg-hover);
}
.sortBtnActive {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-soft);
    font-weight: 600;
}
.filterBtn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-fast);
}
.filterBtn:hover {
    background: var(--bg-hover);
}
.filterBtnActive {
    color: #dc2626;
    border-color: #dc2626;
    background: #dc262610;
    font-weight: 600;
}

/* Score breakdown */
.scoreBreakdown {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
}
.breakdownItem {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 3px;
}
.unexecutedDot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ea580c;
    display: inline-block;
}
```

**Step 6: Commit**

```bash
git add web/src/components/auction/SignalTopTab.tsx web/src/components/auction/SignalTopTab.module.css
git commit -m "feat: add summary stats, sorting, and compensation filter to signal tab"
```

---

## Task 6: Frontend — Add Auction Data Display to Signal Cards

**Problem:** Signal cards show address and price but missing key auction info (매각기일, 지목).

**Files:**
- Modify: `web/src/components/auction/SignalTopTab.tsx`

**Step 1: Enhance cardMeta section**

Replace the cardMeta div content with:

```tsx
<div className={styles.cardMeta}>
    {auc["사건번호"] && <span>{String(auc["사건번호"])}</span>}
    {auc["물건종류"] && <span>{String(auc["물건종류"])}</span>}
    {auc["지목"] && <span>{String(auc["지목"])}</span>}
    {auc["면적"] && <span>{String(auc["면적"])}</span>}
    {auc["매각기일"] && <span>{String(auc["매각기일"])}</span>}
</div>
```

**Step 2: Commit**

```bash
git add web/src/components/auction/SignalTopTab.tsx
git commit -m "feat: show sale date and land category in signal cards"
```

---

## Task 7: Verify & Build

**Step 1: Run Next.js type check**

```bash
cd web && npx next build 2>&1 | head -30
```
Expected: Build succeeds or only warnings

**Step 2: Verify crawler config**

```bash
cd crawler && source .venv/bin/activate
python -c "from config import COUNCIL_API_CONFIG; print('OK:', COUNCIL_API_CONFIG['base_url'])"
```
Expected: `OK: https://clik.nanet.go.kr/openapi/minutes.do`

**Step 3: Final commit (if fixes needed)**

---

## Execution Summary

| Task | Scope | Files | Risk |
|------|-------|-------|------|
| 1 | Crawler fix | config.py, run-crawl.sh | Low (config addition) |
| 2 | Housing filter | precompute/route.ts | Low (single filter) |
| 3 | Scoring redesign | precompute/route.ts | Medium (core logic change) |
| 4 | Top 100 cap | signal-top/route.ts | Low (limit change) |
| 5 | Frontend stats/sort | SignalTopTab.tsx, .module.css | Medium (UI additions) |
| 6 | Card info | SignalTopTab.tsx | Low (display only) |
| 7 | Verify | — | — |
