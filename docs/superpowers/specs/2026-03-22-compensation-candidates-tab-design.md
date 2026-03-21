# Design Spec: 보상 후보 Tab + Scoring Engine Update

## Overview

Add a dedicated "보상 후보" tab that pre-filters auction items with 도시계획시설 포함/저촉 relationships, eliminating the need for manual keyword searches. Simultaneously remove the `price_attractiveness` factor from the global scoring engine and reweight the remaining 4 factors.

## Problem

Users currently find compensation candidates by manually searching keywords like "소로" in the 경매 목록 search tab. This requires domain knowledge (knowing which facility names to search) and repeated searches for each facility type. The 투자 시그널 tab shows scored items but mixes facility-based candidates with items scored for other reasons.

## Solution

**Two changes:**

1. **New "보상 후보" tab** — 4th tab in the nav bar, showing only items where `포함` or `저촉` columns are non-null. Primary navigation is facility-type filter pills (도로, 공원, 학교, etc.) auto-extracted from data. Reuses existing `property_scores` data with new filter parameters.

2. **Scoring engine update** — Remove `price_attractiveness` factor globally. Reweight to: 시설저촉 40%, 사업단계 30%, 경과연수 15%, 유찰 15%.

**Both changes require a re-precompute** to update stored scores and populate new `auction_data` fields.

## Architecture

### Data Flow

```
[property_scores table] (after re-precompute with 포함/저촉 in auction_data)
        |
        | filter WHERE auction_data has non-null 포함 or 저촉
        v
[/api/signal-top?filter_facility=1&facility_type=도로]
        |
        v
[CompensationTab component]
```

No new database tables. The existing `property_scores` table is extended by adding `포함` and `저촉` fields to the `auction_data` JSON during precompute.

### Scoring Engine Changes

**File:** `web/src/lib/scoring/config.ts`

Remove `price_attractiveness` from weights, config, and `ScoreComponent` type:

```
Before:                          After:
facility_coverage: 0.20          facility_coverage: 0.40
facility_age:      0.10          facility_age:      0.15
gosi_stage:        0.30          gosi_stage:        0.30
price_attractiveness: 0.25       (removed)
timing:            0.15          timing:            0.15
                                 Total:             1.00
```

**File:** `web/src/lib/scoring/engine.ts`

- Remove `scorePriceAttractiveness()` function (lines 64-72)
- Remove `minToOfficialRatio` from `ScoringInput` interface (line 22)
- Remove `price_attractiveness` from `calculateScore()` computation and `components` output
- `ScoreBreakdown.components` will have 4 entries instead of 5

**File:** `web/src/lib/scoring/__tests__/engine.test.ts`

- Remove `price_attractiveness` test cases
- Update composite score test expectations to reflect new weights

### Precompute Changes

**File:** `web/src/app/api/signal-top/precompute/route.ts`

- Add `포함` and `저촉` to the `auction_data` JSON blob (lines 239-255):
  ```typescript
  auction_data: JSON.stringify({
      // ... existing fields
      포함: item["포함"],      // ADD
      저촉: item["저촉"],      // ADD
      score_breakdown: scoreResult.components,
      gosi_stage: maxGosiStage,
  }),
  ```
- Remove `minToOfficialRatio` from the scoring input passed to `calculateScore()`

**Deployment note:** After deploying the code changes, trigger a full re-precompute (`POST /api/signal-top/precompute?refresh=true`) to update all stored scores and populate the new `auction_data` fields.

### API Changes

**File:** `web/src/lib/minutes/cache/signals.ts`

Add new query options to `ScoreQueryOptions`:

```typescript
export interface ScoreQueryOptions {
    // ... existing fields
    filterFacility?: boolean;      // only items with 포함 or 저촉
    facilityType?: string;         // filter by facility type keyword (e.g., "도로")
}
```

In `buildScoreQuery()`, add WHERE clauses:

```sql
-- filterFacility=true (포함 or 저촉 non-null in auction_data)
WHERE (json_extract(auction_data, '$.포함') IS NOT NULL
       AND json_extract(auction_data, '$.포함') != '')
   OR (json_extract(auction_data, '$.저촉') IS NOT NULL
       AND json_extract(auction_data, '$.저촉') != '')

-- facilityType="도로" (additional filter, matches against 포함/저촉 text values)
AND (json_extract(auction_data, '$.포함') LIKE '%도로%'
     OR json_extract(auction_data, '$.저촉') LIKE '%도로%')
```

Update `ScoreSortKey` type — remove `"price_ratio"`:

```typescript
export type ScoreSortKey = "score" | "facility_age" | "gosi_stage" | "facility" | "compensation";
```

Add a new function to extract facility type counts for the filter pills:

```typescript
export async function getFacilityTypeCounts(): Promise<{ type: string; count: number }[]>
```

Implementation: queries all items where 포함 or 저촉 is non-null, concatenates both column values, extracts the facility category from the text (the part after " — ", e.g., "소로1류(8m미만) — **도로**"), groups and counts by category. Falls back to the raw text if no " — " separator exists.

**File:** `web/src/app/api/signal-top/route.ts`

- Add query params: `filter_facility` and `facility_type`. Pass through to `getPropertyScores()`.
- Remove `"price_ratio"` from `VALID_SORTS` set.
- When `filter_facility=1`, lift the `MAX_RESULTS=100` cap (compensation candidates may exceed 100 items and users need to see all of them).

### New Component

**File:** `web/src/components/auction/CompensationTab.tsx`

New component that renders:

1. **Stats bar** — total 포함/저촉 items, 보상 단계 count, 미집행 count
2. **Facility type filter pills** — fetched via a new `/api/signal-top/facility-types` endpoint (or inlined in the main response). Shows "전체 N", "도로 N", "공원 N", etc. with counts. Active pill is highlighted.
3. **Sort/filter controls** — sort by: 점수순 (`score`), 경과연수순 (`facility_age`), 사업단계순 (`gosi_stage`). Filters: 포함만, 미집행만.
4. **Card list** — reuses the card layout pattern from SignalTopTab with one addition: a highlighted facility info section showing the 포함/저촉 type, facility name, execution status, and age prominently.
5. **Pagination** — reuses existing Pagination component.

**Styling:** `web/src/components/auction/CompensationTab.module.css` — follows existing CSS module patterns. The facility highlight section uses a darker background to make it the visual hero of each card.

### Tab Registration

**File:** `web/src/components/auction/AuctionPageClient.tsx`

- Add `"compensation"` to `TabId` union type
- Add `{ id: "compensation", label: "보상 후보" }` to tabs array (position: after "투자 시그널", before "회의록 검색")
- Dynamic import: `const CompensationTab = dynamic(() => import("./CompensationTab"), { ssr: false })`
- Render: `{activeTab === "compensation" && <CompensationTab />}`
- Show hot zone alerts banner on compensation tab too (extend the existing `activeTab === "signal-top"` condition to also include `"compensation"`)

### UI Updates for Scoring Change

**File:** `web/src/components/auction/SignalTopTab.tsx`

- Remove `"price_attractiveness"` / "가격매력" from the `breakdownGrid` rendering (5-bar → 4-bar)
- Remove `"price_ratio"` from sort options in the sort button array
- Keep price display in card (감정평가액, 최저매각가격, 공시지가비율) as informational — just not scored

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/scoring/config.ts` | **Modify** | Remove price_attractiveness, reweight to 40/30/15/15 |
| `lib/scoring/engine.ts` | **Modify** | Remove price scoring function and references |
| `lib/scoring/__tests__/engine.test.ts` | **Modify** | Remove price tests, update composite score expectations |
| `lib/minutes/cache/signals.ts` | **Modify** | Add filterFacility/facilityType query options, getFacilityTypeCounts(), remove price_ratio from ScoreSortKey |
| `app/api/signal-top/route.ts` | **Modify** | Accept filter_facility/facility_type params, remove price_ratio from VALID_SORTS, lift MAX_RESULTS cap for facility filter |
| `app/api/signal-top/precompute/route.ts` | **Modify** | Add 포함/저촉 to auction_data JSON, remove minToOfficialRatio from scoring input |
| `components/auction/AuctionPageClient.tsx` | **Modify** | Add 4th tab "보상 후보", show hot zone alerts on compensation tab |
| `components/auction/SignalTopTab.tsx` | **Modify** | Remove price_attractiveness from breakdown display and sort options |
| `components/auction/CompensationTab.tsx` | **Create** | New tab component |
| `components/auction/CompensationTab.module.css` | **Create** | New tab styles |

## Deployment Steps

1. Deploy code changes
2. Trigger full re-precompute: `POST /api/signal-top/precompute?refresh=true`
3. Verify scores are updated and 보상 후보 tab shows filtered results

## Out of Scope

- New crawling or external API calls
- Changes to the 회의록 검색 tab
- Changes to the 경매 목록 search tab
- New database tables
