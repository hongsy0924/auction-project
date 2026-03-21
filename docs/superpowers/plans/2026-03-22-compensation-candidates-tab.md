# Compensation Candidates Tab + Scoring Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "보상 후보" tab showing pre-filtered 포함/저촉 items with facility-type filters, and remove price-based scoring globally.

**Architecture:** Reuse existing `property_scores` cache with new query filters. Extend `auction_data` JSON to include 포함/저촉 fields during precompute. New `CompensationTab` component with facility-type pills as primary navigation.

**Tech Stack:** Next.js 16, React 19, TypeScript, SQLite (via better-sqlite3), CSS Modules, Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-compensation-candidates-tab-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/lib/scoring/config.ts` | Modify | Scoring weights and type definitions |
| `web/src/lib/scoring/engine.ts` | Modify | Score calculation logic |
| `web/src/lib/scoring/precompute.ts` | Modify | ScoringInput builder |
| `web/src/lib/scoring/__tests__/engine.test.ts` | Modify | Scoring tests |
| `web/src/lib/minutes/cache/signals.ts` | Modify | Query builder with facility filters |
| `web/src/app/api/signal-top/route.ts` | Modify | API endpoint params |
| `web/src/app/api/signal-top/precompute/route.ts` | Modify | auction_data JSON shape |
| `web/src/components/auction/AuctionPageClient.tsx` | Modify | Tab registration |
| `web/src/components/auction/SignalTopTab.tsx` | Modify | Remove price from UI |
| `web/src/components/auction/CompensationTab.tsx` | Create | New tab component |
| `web/src/components/auction/CompensationTab.module.css` | Create | New tab styles |

---

### Task 1: Update Scoring Config and Engine (remove price_attractiveness)

**Files:**
- Modify: `web/src/lib/scoring/config.ts`
- Modify: `web/src/lib/scoring/engine.ts`
- Modify: `web/src/lib/scoring/precompute.ts`

- [ ] **Step 1: Update scoring config**

In `web/src/lib/scoring/config.ts`, replace the entire file:

```typescript
/**
 * Scoring configuration for auction property investment analysis.
 * Score is 0-1.0 weighted across 4 factors.
 */

export const SCORING_CONFIG = {
    weights: {
        facility_coverage: 0.40,   // 도시계획시설 저촉 정도 (primary signal)
        facility_age: 0.15,        // 시설결정 경과연수
        gosi_stage: 0.30,          // 사업 진행도
        timing: 0.15,              // 엑싯 타이밍 (유찰)
    },
    facility_coverage: { "포함": 1.0, "저촉": 0.7, "접합": 0.3 } as Record<string, number>,
    facility_age: [
        { minYears: 18, score: 1.0 },
        { minYears: 15, score: 0.8 },
        { minYears: 10, score: 0.5 },
        { minYears: 5, score: 0.2 },
        { minYears: 0, score: 0.1 },
    ],
    gosi_stage: { 0: 0.0, 1: 0.3, 2: 0.5, 3: 0.8, 4: 1.0 } as Record<number, number>,
    timing: { yuchalBonusPerCount: 0.15, yuchalMaxBonus: 0.6 },
};

export type ScoreComponent = "facility_coverage" | "facility_age" | "gosi_stage" | "timing";
```

- [ ] **Step 2: Update scoring engine**

In `web/src/lib/scoring/engine.ts`, remove `scorePriceAttractiveness` function (lines 63-72), remove `minToOfficialRatio` from `ScoringInput` (line 22), and update `calculateScore` to use 4 factors:

```typescript
/**
 * Weighted scoring engine for auction property investment analysis.
 * Replaces the old 200-point proxy scoring with a 0-1.0 data-driven score.
 */
import { SCORING_CONFIG, type ScoreComponent } from "./config";

export interface ScoreBreakdown {
    total: number;
    components: Record<ScoreComponent, { raw: number; weighted: number }>;
}

export interface ScoringInput {
    /** 포함/저촉/접합 text from DB — used to determine facility coverage */
    facilityInclude?: string | null;  // "포함" column value
    facilityConflict?: string | null; // "저촉" column value
    facilityAdjoin?: string | null;   // "접합" column value
    /** Facility age in years (from registDt) */
    facilityAgeYears?: number | null;
    /** Highest gosi stage for this property (0-4) */
    gosiStage?: number;
    /** 유찰 횟수 */
    yuchalCount?: number;
}

/** Calculate facility coverage score (0-1.0) from 포함/저촉/접합 data. */
function scoreFacilityCoverage(input: ScoringInput): number {
    const cfg = SCORING_CONFIG.facility_coverage;
    let maxScore = 0;

    // Check each coverage type — take the highest
    if (input.facilityInclude && input.facilityInclude.trim()) {
        maxScore = Math.max(maxScore, cfg["포함"] ?? 0);
    }
    if (input.facilityConflict && input.facilityConflict.trim()) {
        maxScore = Math.max(maxScore, cfg["저촉"] ?? 0);
    }
    if (input.facilityAdjoin && input.facilityAdjoin.trim()) {
        maxScore = Math.max(maxScore, cfg["접합"] ?? 0);
    }

    return maxScore;
}

/** Calculate facility age score (0-1.0). */
function scoreFacilityAge(input: ScoringInput): number {
    const years = input.facilityAgeYears;
    if (years == null || years <= 0) return 0;

    for (const tier of SCORING_CONFIG.facility_age) {
        if (years >= tier.minYears) return tier.score;
    }
    return 0;
}

/** Calculate gosi stage score (0-1.0). */
function scoreGosiStage(input: ScoringInput): number {
    const stage = input.gosiStage ?? 0;
    return SCORING_CONFIG.gosi_stage[stage] ?? 0;
}

/** Calculate timing score (0-1.0) based on yuchal count. */
function scoreTiming(input: ScoringInput): number {
    const count = input.yuchalCount ?? 0;
    const cfg = SCORING_CONFIG.timing;
    return Math.min(count * cfg.yuchalBonusPerCount, cfg.yuchalMaxBonus);
}

/**
 * Calculate the composite investment score (0-1.0).
 * Returns total and per-component breakdown.
 */
export function calculateScore(input: ScoringInput): ScoreBreakdown {
    const weights = SCORING_CONFIG.weights;

    const fc = scoreFacilityCoverage(input);
    const fa = scoreFacilityAge(input);
    const gs = scoreGosiStage(input);
    const tm = scoreTiming(input);

    const total =
        fc * weights.facility_coverage +
        fa * weights.facility_age +
        gs * weights.gosi_stage +
        tm * weights.timing;

    return {
        total: Math.round(total * 1000) / 1000, // 3 decimal places
        components: {
            facility_coverage: { raw: fc, weighted: fc * weights.facility_coverage },
            facility_age: { raw: fa, weighted: fa * weights.facility_age },
            gosi_stage: { raw: gs, weighted: gs * weights.gosi_stage },
            timing: { raw: tm, weighted: tm * weights.timing },
        },
    };
}
```

- [ ] **Step 3: Update precompute.ts — remove minToOfficialRatio**

In `web/src/lib/scoring/precompute.ts`, remove line 11 (`minToOfficialRatio`):

```typescript
import { calculateScore } from "./engine";
import type { ScoringInput } from "./engine";

export function buildScoringInput(item: Record<string, unknown>, gosiStage: number): ScoringInput {
    return {
        facilityInclude: String(item["포함"] || ""),
        facilityConflict: String(item["저촉"] || ""),
        facilityAdjoin: String(item["접합"] || ""),
        facilityAgeYears: parseFloat(String(item["시설경과연수"] || "0")) || undefined,
        gosiStage,
        yuchalCount: parseInt(String(item["유찰회수"] || "0"), 10) || 0,
    };
}

export function scoreItem(item: Record<string, unknown>, gosiStage: number) {
    const input = buildScoringInput(item, gosiStage);
    return calculateScore(input);
}
```

- [ ] **Step 4: Run type check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/scoring/config.ts web/src/lib/scoring/engine.ts web/src/lib/scoring/precompute.ts
git commit -m "refactor: remove price_attractiveness from scoring, reweight to 40/30/15/15"
```

---

### Task 2: Update Scoring Tests

**Files:**
- Modify: `web/src/lib/scoring/__tests__/engine.test.ts`

- [ ] **Step 1: Update test file**

Remove price_attractiveness tests (lines 70-86), update weighted expectations to new weights, update composite test:

```typescript
import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringInput } from "../engine";
import { buildScoringInput } from "../precompute";

describe("calculateScore", () => {
    it("returns 0 for completely empty input", () => {
        const result = calculateScore({});
        expect(result.total).toBe(0);
    });

    it("scores facility_coverage: 포함 = 1.0 raw", () => {
        const result = calculateScore({ facilityInclude: "도로" });
        expect(result.components.facility_coverage.raw).toBe(1.0);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.4); // 1.0 * 0.40
    });

    it("scores facility_coverage: 저촉 = 0.7 raw", () => {
        const result = calculateScore({ facilityConflict: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.7);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.28); // 0.7 * 0.40
    });

    it("scores facility_coverage: 접합 = 0.3 raw", () => {
        const result = calculateScore({ facilityAdjoin: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.3);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.12); // 0.3 * 0.40
    });

    it("takes max when multiple coverage types exist", () => {
        const result = calculateScore({
            facilityInclude: "공원",
            facilityConflict: "도로",
        });
        expect(result.components.facility_coverage.raw).toBe(1.0);
    });

    it("ignores whitespace-only facility strings", () => {
        const result = calculateScore({ facilityInclude: "   " });
        expect(result.components.facility_coverage.raw).toBe(0);
    });

    it("scores facility_age tiers correctly", () => {
        expect(calculateScore({ facilityAgeYears: 20 }).components.facility_age.raw).toBe(1.0);
        expect(calculateScore({ facilityAgeYears: 16 }).components.facility_age.raw).toBe(0.8);
        expect(calculateScore({ facilityAgeYears: 12 }).components.facility_age.raw).toBe(0.5);
        expect(calculateScore({ facilityAgeYears: 7 }).components.facility_age.raw).toBe(0.2);
        expect(calculateScore({ facilityAgeYears: 3 }).components.facility_age.raw).toBe(0.1);
    });

    it("scores facility_age: null/0/negative → 0", () => {
        expect(calculateScore({ facilityAgeYears: null }).components.facility_age.raw).toBe(0);
        expect(calculateScore({ facilityAgeYears: 0 }).components.facility_age.raw).toBe(0);
        expect(calculateScore({ facilityAgeYears: -5 }).components.facility_age.raw).toBe(0);
    });

    it("scores gosi_stage 0-4", () => {
        expect(calculateScore({ gosiStage: 0 }).components.gosi_stage.raw).toBe(0.0);
        expect(calculateScore({ gosiStage: 1 }).components.gosi_stage.raw).toBe(0.3);
        expect(calculateScore({ gosiStage: 2 }).components.gosi_stage.raw).toBe(0.5);
        expect(calculateScore({ gosiStage: 3 }).components.gosi_stage.raw).toBe(0.8);
        expect(calculateScore({ gosiStage: 4 }).components.gosi_stage.raw).toBe(1.0);
    });

    it("scores timing: yuchalCount capped at 0.6", () => {
        expect(calculateScore({ yuchalCount: 1 }).components.timing.raw).toBeCloseTo(0.15);
        expect(calculateScore({ yuchalCount: 3 }).components.timing.raw).toBeCloseTo(0.45);
        expect(calculateScore({ yuchalCount: 5 }).components.timing.raw).toBeCloseTo(0.6);
        expect(calculateScore({ yuchalCount: 10 }).components.timing.raw).toBeCloseTo(0.6);
    });

    it("composite score sums weighted components", () => {
        const input: ScoringInput = {
            facilityInclude: "도로",      // raw=1.0, weighted=0.40
            facilityAgeYears: 20,         // raw=1.0, weighted=0.15
            gosiStage: 4,                 // raw=1.0, weighted=0.30
            yuchalCount: 5,               // raw=0.6, weighted=0.09
        };
        const result = calculateScore(input);
        // 0.40 + 0.15 + 0.30 + 0.09 = 0.94
        expect(result.total).toBeCloseTo(0.94, 2);
    });

    it("total is rounded to 3 decimal places", () => {
        const result = calculateScore({ facilityConflict: "도로", yuchalCount: 1 });
        // 0.7*0.40 + 0.15*0.15 = 0.28 + 0.0225 = 0.3025 → rounds to 0.303
        const totalStr = result.total.toString();
        const decimals = totalStr.split(".")[1] || "";
        expect(decimals.length).toBeLessThanOrEqual(3);
    });
});

describe("buildScoringInput", () => {
    it("extracts scoring fields from auction item", () => {
        const item = {
            "포함": "도로",
            "저촉": "",
            "접합": "",
            "시설경과연수": "15.5",
            "유찰회수": "3",
        };
        const input = buildScoringInput(item, 2);
        expect(input.facilityInclude).toBe("도로");
        expect(input.facilityAgeYears).toBeCloseTo(15.5);
        expect(input.yuchalCount).toBe(3);
        expect(input.gosiStage).toBe(2);
        // minToOfficialRatio should no longer exist
        expect((input as Record<string, unknown>).minToOfficialRatio).toBeUndefined();
    });

    it("handles missing/zero values gracefully", () => {
        const item = {};
        const input = buildScoringInput(item, 0);
        expect(input.facilityInclude).toBe("");
        expect(input.facilityAgeYears).toBeUndefined();
        expect(input.yuchalCount).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests**

Run: `cd web && npx vitest run src/lib/scoring/__tests__/engine.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/scoring/__tests__/engine.test.ts
git commit -m "test: update scoring tests for 4-factor weights"
```

---

### Task 3: Add Facility Filter to Query Layer and API

**Files:**
- Modify: `web/src/lib/minutes/cache/signals.ts`
- Modify: `web/src/app/api/signal-top/route.ts`

- [ ] **Step 1: Update ScoreQueryOptions and ScoreSortKey in signals.ts**

In `web/src/lib/minutes/cache/signals.ts`, update the type and interface (around lines 109-117):

Change `ScoreSortKey` (line 109) to remove `"price_ratio"`:
```typescript
export type ScoreSortKey = "score" | "facility_age" | "gosi_stage" | "facility" | "compensation";
```

Add new fields to `ScoreQueryOptions` (after line 116):
```typescript
export interface ScoreQueryOptions {
    limit?: number;
    offset?: number;
    sort?: ScoreSortKey;
    filterCompensation?: boolean;
    excludeHousing?: boolean;
    filterFacility?: boolean;
    facilityType?: string;
    filterIncludeOnly?: boolean;
    filterUnexecutedOnly?: boolean;
}
```

- [ ] **Step 2: Update buildScoreQuery in signals.ts**

In `buildScoreQuery()` (line 119), add WHERE clauses for the new filters. After the `excludeHousing` block (line 131) and before `const whereClause`:

```typescript
    if (opts.filterFacility) {
        where.push(`(
            (json_extract(auction_data, '$.포함') IS NOT NULL AND json_extract(auction_data, '$.포함') != '')
            OR (json_extract(auction_data, '$.저촉') IS NOT NULL AND json_extract(auction_data, '$.저촉') != '')
        )`);
    }

    if (opts.facilityType) {
        where.push(`(
            json_extract(auction_data, '$.포함') LIKE ?
            OR json_extract(auction_data, '$.저촉') LIKE ?
        )`);
        params.push(`%${opts.facilityType}%`, `%${opts.facilityType}%`);
    }

    if (opts.filterIncludeOnly) {
        where.push("(json_extract(auction_data, '$.포함') IS NOT NULL AND json_extract(auction_data, '$.포함') != '')");
    }

    if (opts.filterUnexecutedOnly) {
        where.push("has_unexecuted = 1");
    }
```

**Important:** The `facilityType` params must be pushed BEFORE the LIMIT/OFFSET params. Currently params for LIMIT/OFFSET are pushed at line 161. The `facilityType` params go into the `where` array which is processed before ORDER BY / LIMIT, so they need to be in `params` before the limit/offset push. This is already correct because the `params.push(opts.limit, opts.offset)` happens after all WHERE clause params.

Also remove the `"price_ratio"` case from the switch statement (lines 142-144):

Remove:
```typescript
        case "price_ratio":
            orderBy = "CAST(json_extract(auction_data, '$.\"최저가/공시지가비율\"') AS REAL) ASC, score DESC";
            break;
```

- [ ] **Step 3: Add getFacilityTypeCounts function in signals.ts**

Add after the `clearPropertyScores` function (after line 223):

```typescript
export async function getFacilityTypeCounts(): Promise<{ type: string; count: number }[]> {
    await ensureInitialized();

    // Get all items with non-null 포함 or 저촉
    const rows = await allAsync<{ pohaam: string | null; jeochok: string | null }>(
        `SELECT
            json_extract(auction_data, '$.포함') as pohaam,
            json_extract(auction_data, '$.저촉') as jeochok
         FROM property_scores
         WHERE (json_extract(auction_data, '$.포함') IS NOT NULL AND json_extract(auction_data, '$.포함') != '')
            OR (json_extract(auction_data, '$.저촉') IS NOT NULL AND json_extract(auction_data, '$.저촉') != '')`,
        []
    );

    // Extract facility category from text like "소로1류(8m미만) — 도로" → "도로"
    // Handles various dash characters: em-dash (—), en-dash (–), hyphen (-)
    const counts = new Map<string, number>();
    for (const row of rows) {
        const categories = new Set<string>();
        for (const val of [row.pohaam, row.jeochok]) {
            if (!val || !val.trim()) continue;
            const parts = val.split(/\s*[—–\-]\s*/).filter(Boolean);
            const category = parts.length > 1 ? parts[parts.length - 1] : parts[0];
            if (category) categories.add(category);
        }
        for (const cat of categories) {
            counts.set(cat, (counts.get(cat) || 0) + 1);
        }
    }

    return Array.from(counts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Export new function from cache index**

Check if `web/src/lib/minutes/cache/index.ts` (or wherever the cache barrel export is) re-exports from signals.ts. Add `getFacilityTypeCounts` to the exports.

- [ ] **Step 5: Update API route**

In `web/src/app/api/signal-top/route.ts`:

Update `VALID_SORTS` (line 13) to remove `"price_ratio"`:
```typescript
const VALID_SORTS = new Set<ScoreSortKey>(["score", "facility_age", "gosi_stage", "facility", "compensation"]);
```

Add new param parsing (after line 22):
```typescript
    const filterFacility = searchParams.get("filter_facility") === "1";
    const facilityType = searchParams.get("facility_type") || undefined;
    const filterIncludeOnly = searchParams.get("filter_include_only") === "1";
    const filterUnexecutedOnly = searchParams.get("filter_unexecuted_only") === "1";
```

Update `queryOpts` construction (line 33) to include new params:
```typescript
    const queryOpts: ScoreQueryOptions = {
        limit: adjustedLimit, offset, sort, filterCompensation, excludeHousing,
        filterFacility, facilityType, filterIncludeOnly, filterUnexecutedOnly,
    };
```

Lift `MAX_RESULTS` cap when `filterFacility` is true. Replace the MAX_RESULTS block (lines 24-32):
```typescript
    const MAX_RESULTS = filterFacility ? 500 : 100;
```

Add facility type counts to response when `filterFacility` is true. Import `getFacilityTypeCounts` and add to response (before the return at line 64):
```typescript
        let facilityTypeCounts: { type: string; count: number }[] = [];
        if (filterFacility) {
            try {
                facilityTypeCounts = await getFacilityTypeCounts();
            } catch { /* non-critical */ }
        }

        return Response.json({ data, total, page, perPage, hotZoneAlerts, facilityTypeCounts });
```

- [ ] **Step 6: Run type check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/minutes/cache/signals.ts web/src/app/api/signal-top/route.ts
git commit -m "feat: add facility filter to signal-top API and query layer"
```

---

### Task 4: Update Precompute to Include 포함/저촉 in auction_data

**Files:**
- Modify: `web/src/app/api/signal-top/precompute/route.ts`

- [ ] **Step 1: Add 포함 and 저촉 to auction_data JSON**

In `web/src/app/api/signal-top/precompute/route.ts`, at the `auction_data: JSON.stringify({` block (lines 239-255), add two fields after `시설경과연수`:

```typescript
                auction_data: JSON.stringify({
                    사건번호: item["사건번호"],
                    물건종류: item["물건종류"],
                    지목: item["지목"],
                    감정평가액: item["감정평가액"],
                    최저매각가격: item["최저매각가격"],
                    "%": item["%"],
                    매각기일: item["매각기일"],
                    면적: item["면적"],
                    유찰회수: item["유찰회수"],
                    "공시지가(원/㎡)": item["공시지가(원/㎡)"],
                    공시지가총액: item["공시지가총액"],
                    "최저가/공시지가비율": item["최저가/공시지가비율"],
                    시설경과연수: item["시설경과연수"],
                    포함: item["포함"] || null,
                    저촉: item["저촉"] || null,
                    score_breakdown: scoreResult.components,
                    gosi_stage: maxGosiStage,
                }),
```

- [ ] **Step 2: Run type check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/signal-top/precompute/route.ts
git commit -m "feat: include 포함/저촉 in precomputed auction_data JSON"
```

---

### Task 5: Update SignalTopTab UI (remove price from display)

**Files:**
- Modify: `web/src/components/auction/SignalTopTab.tsx`

- [ ] **Step 1: Remove price_ratio from sort options**

In the sort button `.map()` call (line 347), remove `"price_ratio"` from the array. Change:

```typescript
{(["score", "price_ratio", "facility_age", "gosi_stage", "facility", "compensation"] as SortKey[]).map((key) => (
```

To:
```typescript
{(["score", "facility_age", "gosi_stage", "facility", "compensation"] as SortKey[]).map((key) => (
```

Also update the `SortKey` type (line 124):
```typescript
type SortKey = "score" | "facility" | "compensation" | "facility_age" | "gosi_stage";
```

And update the label ternary (line 353) to remove the `price_ratio` case:
```typescript
{key === "score" ? "점수순" : key === "facility" ? "시설순" : key === "compensation" ? "보상순" : key === "facility_age" ? "경과연수" : "사업단계"}
```

- [ ] **Step 2: Remove price_attractiveness from breakdownGrid**

In the breakdown grid (line 559), remove the `["price_attractiveness", "가격매력", "#ea580c"]` entry. Change from 5 entries to 4:

```typescript
{([
    ["facility_coverage", "시설저촉", "#2563eb"],
    ["facility_age", "경과연수", "#7c3aed"],
    ["gosi_stage", "사업단계", "#dc2626"],
    ["timing", "유찰", "#059669"],
] as [string, string, string][]).map(([key, label, color]) => {
```

- [ ] **Step 3: Update the help modal scoring section**

In the help modal, update the 점수 구성 section to show 4 factors with new weights (40/15/30/15) instead of 5.

- [ ] **Step 4: Run type check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/auction/SignalTopTab.tsx
git commit -m "refactor: remove price_attractiveness from SignalTopTab display"
```

---

### Task 6: Create CompensationTab Component

**Files:**
- Create: `web/src/components/auction/CompensationTab.tsx`
- Create: `web/src/components/auction/CompensationTab.module.css`

- [ ] **Step 1: Create CompensationTab.module.css**

Create `web/src/components/auction/CompensationTab.module.css`. Copy the base styles from `SignalTopTab.module.css` and add the facility-specific styles. The full CSS file:

```css
.container {
    animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Stats bar */
.statsBar {
    display: flex;
    gap: 24px;
    padding: 12px 16px;
    background: var(--bg-hover);
    border-radius: var(--radius-md);
    margin-bottom: 8px;
}
.statItem { display: flex; flex-direction: column; gap: 2px; }
.statValue { font-size: 18px; font-weight: 700; color: var(--text-main); line-height: 1; }
.statLabel { font-size: 11px; color: var(--text-muted); }

/* Facility type filter pills */
.facilityFilters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}
.facilityPill {
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: var(--transition-fast);
}
.facilityPill:hover { background: var(--bg-hover); }
.facilityPillActive {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-soft);
    font-weight: 600;
}

/* Sort/Filter controls */
.controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}
.sortGroup { display: flex; gap: 4px; }
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
.sortBtn:hover { background: var(--bg-hover); }
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
.filterBtn:hover { background: var(--bg-hover); }
.filterBtnActive {
    color: #dc2626;
    border-color: #dc2626;
    background: #dc262610;
    font-weight: 600;
}

/* Card list */
.cardList { display: flex; flex-direction: column; gap: 12px; }
.card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg, 12px);
    overflow: hidden;
    transition: var(--transition-base);
}
.card:hover {
    box-shadow: var(--shadow-md);
    border-color: var(--border-light);
}

/* Card header */
.cardHeader {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 20px;
}
.rankBadge { font-size: 13px; font-weight: 800; color: var(--text-muted); min-width: 28px; padding-top: 2px; }
.scoreBadge {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 40px;
    height: 28px;
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    flex-shrink: 0;
}
.gosiBadge {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 10px;
    height: 28px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
    border: 1px solid;
    flex-shrink: 0;
    letter-spacing: 0.3px;
}
.cardInfo { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cardAddress { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--text-main); }
.cardAddress span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cardMeta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
.cardMeta span + span::before { content: "·"; margin-right: 8px; color: var(--border-color); }
.expandToggle { color: var(--text-muted); flex-shrink: 0; padding-top: 4px; }

/* Card body */
.cardBody { padding: 0 20px 14px; display: flex; flex-direction: column; gap: 8px; }

/* Facility highlight (hero) */
.facilityHighlight {
    background: var(--bg-hover, #0f172a);
    border-radius: 8px;
    padding: 10px 12px;
}
.facilityTag {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    border: 1px solid;
}

/* Pills */
.pills { display: flex; flex-wrap: wrap; gap: 6px; }
.pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    border: 1px solid;
}

/* Score breakdown grid */
.breakdownGrid { display: flex; gap: 6px; margin-top: 4px; }
.breakdownColumn { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.breakdownBarTrack { height: 6px; background: var(--bg-hover, #f1f5f9); border-radius: 3px; overflow: hidden; }
.breakdownBarFill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
.breakdownLabel { font-size: 10px; color: var(--text-muted); display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.breakdownValue { font-weight: 700; font-size: 11px; }

/* Analysis expanded section */
.analysisSection {
    border-top: 1px solid var(--border-color);
    padding: 16px 20px;
    animation: slideDown 0.3s ease-out;
}
@keyframes slideDown {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 2000px; }
}
.analysisLoading { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); padding: 8px 0; }
.analysisContent { font-size: 14px; line-height: 1.7; color: var(--text-main); }

/* Empty / loading state */
.emptyState { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 24px; text-align: center; }
.emptyTitle { font-size: 16px; font-weight: 700; color: var(--text-main); margin: 16px 0 4px; }
.emptySubtitle { font-size: 14px; color: var(--text-muted); max-width: 400px; }
.spinIcon { animation: spin 1s linear infinite; }
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: Create CompensationTab.tsx**

Create `web/src/components/auction/CompensationTab.tsx`:

```typescript
"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import styles from "./CompensationTab.module.css";
import {
    ChevronDown, ChevronUp, AlertTriangle, Building2,
    Loader, Search, HelpCircle, X,
} from "lucide-react";
import Pagination from "./Pagination";
import { renderMarkdown } from "@/utils/renderMarkdown";

// Reuse types from SignalTopTab — these come from the same API
interface FacilityDetail {
    facilityName: string;
    facilityType: string;
    executionStatus?: string;
}

interface NoticeDetail {
    title: string;
    noticeType: string;
    noticeDate: string;
    link?: string;
    gosiStage?: number;
    matchType?: string;
}

interface CompensationItem {
    doc_id: string;
    address: string;
    dong: string;
    pnu: string;
    score: number;
    signal_count: number;
    signal_keywords: string[];
    facility_count: number;
    has_unexecuted: number;
    has_compensation: number;
    notice_count: number;
    facility_details: FacilityDetail[];
    notice_details: NoticeDetail[];
    auction_data: Record<string, string | number | undefined>;
    has_analysis: boolean;
    score_breakdown?: Record<string, { raw: number; weighted: number }>;
    gosi_stage?: number;
}

const GOSI_STAGE_LABELS: Record<number, string> = {
    0: "-", 1: "결정", 2: "실시계획", 3: "사업인정", 4: "보상",
};
const GOSI_STAGE_COLORS: Record<number, string> = {
    0: "#9ca3af", 1: "#2563eb", 2: "#7c3aed", 3: "#ea580c", 4: "#dc2626",
};
const KEYWORD_COLORS: Record<string, string> = {
    "보상": "#dc2626", "수용": "#dc2626", "편입": "#ea580c",
    "도시계획": "#2563eb", "착공": "#059669", "개발": "#7c3aed",
    "도로": "#0891b2", "택지": "#ca8a04",
};

function getScoreColor(score: number): string {
    const pct = score <= 1 ? score * 100 : score;
    if (pct >= 80) return "#dc2626";
    if (pct >= 50) return "#ea580c";
    if (pct >= 30) return "#ca8a04";
    return "#059669";
}
function formatScore(score: number): string {
    if (score <= 1) return `${Math.round(score * 100)}%`;
    return String(score);
}
function formatPrice(n: number): string {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n % 100_000_000 === 0 ? 0 : 1)}억`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
    return n.toLocaleString();
}

type SortKey = "score" | "facility_age" | "gosi_stage" | "facility" | "compensation";

export default function CompensationTab() {
    const [items, setItems] = useState<CompensationItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [sortBy, setSortBy] = useState<SortKey>("score");
    const [facilityType, setFacilityType] = useState<string | null>(null);
    const [filterIncludeOnly, setFilterIncludeOnly] = useState(false);
    const [filterUnexecutedOnly, setFilterUnexecutedOnly] = useState(false);
    const [facilityTypeCounts, setFacilityTypeCounts] = useState<{ type: string; count: number }[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [analysisCache, setAnalysisCache] = useState<Record<string, string>>({});
    const [analysisLoading, setAnalysisLoading] = useState<string | null>(null);

    const stats = useMemo(() => ({
        total,
        compensationCount: items.filter((i) => i.has_compensation === 1).length,
        unexecutedCount: items.filter((i) => i.has_unexecuted === 1).length,
    }), [items, total]);

    // Reset page on filter/sort change
    useEffect(() => { setPage(1); }, [sortBy, facilityType, filterIncludeOnly, filterUnexecutedOnly]);

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
            sort: sortBy,
            filter_facility: "1",
        });
        if (facilityType) params.set("facility_type", facilityType);
        if (filterIncludeOnly) params.set("filter_include_only", "1");
        if (filterUnexecutedOnly) params.set("filter_unexecuted_only", "1");

        fetch(`/api/signal-top?${params}`)
            .then((res) => res.json())
            .then((data) => {
                const mapped = (data.data || []).map((item: CompensationItem) => ({
                    ...item,
                    score_breakdown: item.auction_data?.score_breakdown,
                    gosi_stage: item.auction_data?.gosi_stage ?? 0,
                }));
                setItems(mapped);
                setTotal(data.total || 0);
                if (data.facilityTypeCounts) setFacilityTypeCounts(data.facilityTypeCounts);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [page, perPage, sortBy, facilityType, filterIncludeOnly, filterUnexecutedOnly]);

    const totalPages = Math.ceil(total / perPage);

    const handleExpand = useCallback(
        async (docId: string) => {
            if (expandedId === docId) { setExpandedId(null); return; }
            setExpandedId(docId);
            if (!analysisCache[docId]) {
                setAnalysisLoading(docId);
                try {
                    const res = await fetch(`/api/signal-top/analysis?doc_id=${encodeURIComponent(docId)}`);
                    if (res.ok) {
                        const data = await res.json();
                        setAnalysisCache((prev) => ({ ...prev, [docId]: data.analysis_markdown }));
                    }
                } catch { /* ignore */ }
                setAnalysisLoading(null);
            }
        },
        [expandedId, analysisCache]
    );

    // Derive total facility count for "전체" pill
    const totalFacilityCount = useMemo(
        () => facilityTypeCounts.reduce((sum, f) => sum + f.count, 0),
        [facilityTypeCounts]
    );

    if (loading && items.length === 0) {
        return (
            <div className={styles.emptyState}>
                <Loader size={32} className={styles.spinIcon} />
                <p className={styles.emptyTitle}>보상 후보 데이터 로딩 중...</p>
            </div>
        );
    }

    if (!loading && items.length === 0 && !facilityType) {
        return (
            <div className={styles.emptyState}>
                <Search size={40} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                <p className={styles.emptyTitle}>포함/저촉 물건이 없습니다</p>
                <p className={styles.emptySubtitle}>
                    크롤링 후 시그널 분석이 실행되면 도시계획시설 포함/저촉 물건이 여기에 표시됩니다.
                </p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Stats bar */}
            <div className={styles.statsBar}>
                <div className={styles.statItem}>
                    <span className={styles.statValue}>{stats.total}</span>
                    <span className={styles.statLabel}>포함/저촉 물건</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue} style={{ color: "#dc2626" }}>{stats.compensationCount}</span>
                    <span className={styles.statLabel}>보상 단계</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue} style={{ color: "#ea580c" }}>{stats.unexecutedCount}</span>
                    <span className={styles.statLabel}>미집행</span>
                </div>
            </div>

            {/* Facility type filter pills */}
            {facilityTypeCounts.length > 0 && (
                <div className={styles.facilityFilters}>
                    <button
                        className={`${styles.facilityPill} ${facilityType === null ? styles.facilityPillActive : ""}`}
                        onClick={() => setFacilityType(null)}
                    >
                        전체 {totalFacilityCount}
                    </button>
                    {facilityTypeCounts.map((ft) => (
                        <button
                            key={ft.type}
                            className={`${styles.facilityPill} ${facilityType === ft.type ? styles.facilityPillActive : ""}`}
                            onClick={() => setFacilityType(facilityType === ft.type ? null : ft.type)}
                        >
                            {ft.type} {ft.count}
                        </button>
                    ))}
                </div>
            )}

            {/* Sort/Filter controls */}
            <div className={styles.controls}>
                <div className={styles.sortGroup}>
                    {(["score", "facility_age", "gosi_stage", "facility", "compensation"] as SortKey[]).map((key) => (
                        <button
                            key={key}
                            className={`${styles.sortBtn} ${sortBy === key ? styles.sortBtnActive : ""}`}
                            onClick={() => setSortBy(key)}
                        >
                            {key === "score" ? "점수순" : key === "facility_age" ? "경과연수" : key === "gosi_stage" ? "사업단계" : key === "facility" ? "시설순" : "보상순"}
                        </button>
                    ))}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                    <button
                        className={`${styles.filterBtn} ${filterIncludeOnly ? styles.filterBtnActive : ""}`}
                        onClick={() => setFilterIncludeOnly(!filterIncludeOnly)}
                    >
                        포함만
                    </button>
                    <button
                        className={`${styles.filterBtn} ${filterUnexecutedOnly ? styles.filterBtnActive : ""}`}
                        onClick={() => setFilterUnexecutedOnly(!filterUnexecutedOnly)}
                    >
                        미집행만
                    </button>
                </div>
            </div>

            {/* Card list */}
            <div className={styles.cardList}>
                {items.map((item, idx) => {
                    const rank = (page - 1) * perPage + idx + 1;
                    const isExpanded = expandedId === item.doc_id;
                    const analysis = analysisCache[item.doc_id];
                    const isLoadingAnalysis = analysisLoading === item.doc_id;
                    const auc = item.auction_data;
                    const pohaam = auc["포함"] ? String(auc["포함"]) : null;
                    const jeochok = auc["저촉"] ? String(auc["저촉"]) : null;

                    return (
                        <div key={item.doc_id} className={styles.card}>
                            <div className={styles.cardHeader} onClick={() => handleExpand(item.doc_id)} style={{ cursor: "pointer" }}>
                                <div className={styles.rankBadge}>#{rank}</div>
                                <div className={styles.scoreBadge} style={{ background: getScoreColor(item.score) }}>
                                    {formatScore(item.score)}
                                </div>
                                {(item.gosi_stage ?? 0) > 0 && (
                                    <div className={styles.gosiBadge} style={{
                                        background: `${GOSI_STAGE_COLORS[item.gosi_stage || 0]}15`,
                                        color: GOSI_STAGE_COLORS[item.gosi_stage || 0],
                                        borderColor: `${GOSI_STAGE_COLORS[item.gosi_stage || 0]}40`,
                                    }}>
                                        {GOSI_STAGE_LABELS[item.gosi_stage || 0]}
                                    </div>
                                )}
                                <div className={styles.cardInfo}>
                                    <div className={styles.cardAddress}><span>{item.address}</span></div>
                                    <div className={styles.cardMeta}>
                                        {auc["사건번호"] && <span>{String(auc["사건번호"])}</span>}
                                        {auc["물건종류"] && <span>{String(auc["물건종류"])}</span>}
                                        {auc["지목"] && <span>{String(auc["지목"])}</span>}
                                        {auc["면적"] && <span>{String(auc["면적"])}</span>}
                                        {auc["매각기일"] && <span>{String(auc["매각기일"])}</span>}
                                    </div>
                                    <div className={styles.cardMeta}>
                                        {auc["감정평가액"] && <span>{formatPrice(Number(auc["감정평가액"]))}</span>}
                                        {auc["최저매각가격"] && <span>→ {formatPrice(Number(auc["최저매각가격"]))}</span>}
                                        {auc["%"] && <span style={{ color: "#dc2626", fontWeight: 700 }}>{String(auc["%"])}</span>}
                                    </div>
                                </div>
                                <div className={styles.expandToggle}>
                                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </div>
                            </div>

                            <div className={styles.cardBody}>
                                {/* Facility highlight (hero section) */}
                                <div className={styles.facilityHighlight}>
                                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>도시계획시설</div>
                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                                        {pohaam && (
                                            <span className={styles.facilityTag} style={{ background: "#dc262618", color: "#f87171", borderColor: "#dc262630" }}>
                                                포함: {pohaam}
                                            </span>
                                        )}
                                        {jeochok && (
                                            <span className={styles.facilityTag} style={{ background: "#ea580c18", color: "#f97316", borderColor: "#ea580c30" }}>
                                                저촉: {jeochok}
                                            </span>
                                        )}
                                        {item.has_unexecuted === 1 && (
                                            <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>미집행</span>
                                        )}
                                        {auc["시설경과연수"] && Number(auc["시설경과연수"]) > 0 && (
                                            <span style={{ fontSize: "11px", color: "#a78bfa", fontWeight: 600 }}>
                                                경과 {Math.round(Number(auc["시설경과연수"]))}년
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Signal keyword pills */}
                                {item.signal_keywords.length > 0 && (
                                    <div className={styles.pills}>
                                        {item.signal_keywords.map((kw) => (
                                            <span key={kw} className={styles.pill} style={{
                                                background: `${KEYWORD_COLORS[kw] || "#6b7280"}18`,
                                                color: KEYWORD_COLORS[kw] || "#6b7280",
                                                borderColor: `${KEYWORD_COLORS[kw] || "#6b7280"}30`,
                                            }}>
                                                {kw}
                                            </span>
                                        ))}
                                        {item.notice_count > 0 && (
                                            <span className={styles.pill} style={{ background: "#b91c1c18", color: "#b91c1c", borderColor: "#b91c1c30", fontWeight: 600 }}>
                                                고시 {item.notice_count}건
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Score breakdown (4 factors) */}
                                {item.score_breakdown && (
                                    <div className={styles.breakdownGrid}>
                                        {([
                                            ["facility_coverage", "시설", "#2563eb"],
                                            ["facility_age", "연수", "#7c3aed"],
                                            ["gosi_stage", "단계", "#dc2626"],
                                            ["timing", "유찰", "#059669"],
                                        ] as [string, string, string][]).map(([key, label, color]) => {
                                            const comp = item.score_breakdown?.[key];
                                            if (!comp) return null;
                                            return (
                                                <div key={key} className={styles.breakdownColumn}>
                                                    <div className={styles.breakdownBarTrack}>
                                                        <div className={styles.breakdownBarFill} style={{
                                                            width: `${Math.max(comp.raw * 100, 2)}%`,
                                                            background: color,
                                                            opacity: comp.raw > 0 ? 1 : 0.15,
                                                        }} />
                                                    </div>
                                                    <span className={styles.breakdownLabel} style={{ color: comp.raw > 0 ? color : undefined }}>
                                                        {label}
                                                        {comp.raw > 0 && <span className={styles.breakdownValue}>{(comp.raw * 100).toFixed(0)}</span>}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Expanded analysis */}
                            {isExpanded && (
                                <div className={styles.analysisSection}>
                                    {isLoadingAnalysis ? (
                                        <div className={styles.analysisLoading}>
                                            <Loader size={16} className={styles.spinIcon} />
                                            <span>분석 결과 로딩 중...</span>
                                        </div>
                                    ) : analysis ? (
                                        <div className={styles.analysisContent} dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }} />
                                    ) : (
                                        <div className={styles.analysisLoading}>
                                            <span>분석 결과를 불러올 수 없습니다.</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {totalPages > 1 && (
                <div style={{ padding: "24px 0" }}>
                    <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Run type check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/components/auction/CompensationTab.tsx web/src/components/auction/CompensationTab.module.css
git commit -m "feat: add CompensationTab component with facility-type filters"
```

---

### Task 7: Register Tab in AuctionPageClient

**Files:**
- Modify: `web/src/components/auction/AuctionPageClient.tsx`

- [ ] **Step 1: Add dynamic import and tab type**

Add import (after line 17):
```typescript
const CompensationTab = dynamic(() => import("./CompensationTab"), { ssr: false });
```

Update TabId type (line 19):
```typescript
type TabId = "auction-list" | "signal-top" | "compensation" | "minutes";
```

- [ ] **Step 2: Add tab to navigation array**

In the tabs array (around line 110-113), add the new tab between signal-top and minutes:
```typescript
{ id: "signal-top" as TabId, label: "투자 시그널" },
{ id: "compensation" as TabId, label: "보상 후보" },
{ id: "minutes" as TabId, label: "회의록 검색" },
```

- [ ] **Step 3: Extend hot zone alert condition**

Change line 185 from:
```typescript
{activeTab === "signal-top" && hotZoneAlerts.length > 0 && (
```
To:
```typescript
{(activeTab === "signal-top" || activeTab === "compensation") && hotZoneAlerts.length > 0 && (
```

Also extend the hot zone data fetch useEffect (line 50) from:
```typescript
if (activeTab === "signal-top") {
```
To:
```typescript
if (activeTab === "signal-top" || activeTab === "compensation") {
```

- [ ] **Step 4: Add tab content rendering**

After line 222 (`{activeTab === "signal-top" && <SignalTopTab />}`), add:
```typescript
{activeTab === "compensation" && <CompensationTab />}
```

- [ ] **Step 5: Run type check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/auction/AuctionPageClient.tsx
git commit -m "feat: register 보상 후보 tab in navigation"
```

---

### Task 8: Update CLAUDE.md and Trigger Re-precompute

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md scoring section**

In the project root `CLAUDE.md`, update the Scoring Engine section to reflect 4 factors with new weights:

```markdown
## Scoring Engine (web/src/lib/scoring/)

4-factor weighted score (0-1.0):
- **facility_coverage** (0.40): 포함=1.0, 저촉=0.7, 접합=0.3
- **facility_age** (0.15): Years since registDt (18yr+=1.0)
- **gosi_stage** (0.30): Stage 0-4 (보상=1.0, 사업인정=0.8)
- **timing** (0.15): 유찰 count bonus
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md scoring section to 4-factor weights"
```

- [ ] **Step 3: Trigger re-precompute**

Start the dev server and trigger a full re-precompute to update all stored scores and populate the new 포함/저촉 fields in auction_data:

Run: `curl -X POST http://localhost:3000/api/signal-top/precompute?refresh=true -H "Authorization: Bearer $PRECOMPUTE_SECRET"`

Wait for completion (check server logs for "[Precompute] Done" message).

---

### Task 9: Visual Validation in Browser

- [ ] **Step 1: Ensure dev server is running**

Run: `cd web && npm run dev`

- [ ] **Step 2: Open browser and validate**

Navigate to the app in browser. Check:
1. 4 tabs visible: 경매 목록 | 투자 시그널 | 보상 후보 | 회의록 검색
2. 투자 시그널 tab: score breakdown shows 4 bars (no 가격매력), no "공시지가비율" sort button
3. 보상 후보 tab: shows facility-type filter pills, stats bar, card list with facility highlight section
4. Cards show 포함/저촉 info, score, gosi stage
5. Facility type pills filter correctly when clicked
6. Sort buttons work
7. Pagination works
8. Card expansion loads analysis

- [ ] **Step 3: Take screenshots for evidence**

- [ ] **Step 4: Final commit if any tweaks needed**

```bash
git add -u
git commit -m "fix: adjustments from visual validation"
```
