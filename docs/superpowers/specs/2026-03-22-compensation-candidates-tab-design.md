# Design Spec: 보상 후보 Tab + Scoring Engine Update

## Overview

Add a dedicated "보상 후보" tab that pre-filters auction items with 도시계획시설 포함/저촉 relationships, eliminating the need for manual keyword searches. Simultaneously remove the `price_attractiveness` factor from the global scoring engine and reweight the remaining 4 factors.

## Problem

Users currently find compensation candidates by manually searching keywords like "소로" in the 경매 목록 search tab. This requires domain knowledge (knowing which facility names to search) and repeated searches for each facility type. The 투자 시그널 tab shows scored items but mixes facility-based candidates with items scored for other reasons.

## Solution

**Two changes:**

1. **New "보상 후보" tab** — 4th tab in the nav bar, showing only items where `포함` or `저촉` columns are non-null. Primary navigation is facility-type filter pills (도로, 공원, 학교, etc.) auto-extracted from data. Reuses existing `property_scores` data with a new filter parameter.

2. **Scoring engine update** — Remove `price_attractiveness` factor globally. Reweight to: 시설저촉 40%, 사업단계 30%, 경과연수 15%, 유찰 15%.

## Architecture

### Data Flow

```
[property_scores table] (already precomputed)
        |
        | NEW: filter WHERE facility_count > 0
        |      AND (auction_data has non-null 포함 or 저촉)
        v
[/api/signal-top?filter_facility=1&facility_type=도로]
        |
        v
[CompensationTab component]
```

No new database tables, no new precomputation pipeline. The existing `property_scores` table already contains `facility_details` (JSON) and `auction_data` (JSON with 포함/저촉 columns).

### Scoring Engine Changes

**File:** `web/src/lib/scoring/config.ts`

Remove `price_attractiveness` from weights and config:

```
Before:                          After:
facility_coverage: 0.20          facility_coverage: 0.40
facility_age:      0.10          facility_age:      0.15
gosi_stage:        0.30          gosi_stage:        0.30
price_attractiveness: 0.25       (removed)
timing:            0.15          timing:            0.15
```

**File:** `web/src/lib/scoring/engine.ts`

- Remove `scorePriceAttractiveness()` function
- Remove `minToOfficialRatio` from `ScoringInput` interface
- Remove `price_attractiveness` from `calculateScore()` computation and breakdown
- Update `ScoreBreakdown` components to exclude `price_attractiveness`

**File:** `web/src/lib/scoring/config.ts`

- Remove `price_attractiveness` from `ScoreComponent` type
- Remove `price_attractiveness` weight and tier config

### API Changes

**File:** `web/src/lib/minutes/cache/signals.ts`

Add two new query options to `ScoreQueryOptions`:

```typescript
export interface ScoreQueryOptions {
    // ... existing fields
    filterFacility?: boolean;      // only items with 포함 or 저촉
    facilityType?: string;         // filter by facility type keyword (e.g., "도로")
}
```

In `buildScoreQuery()`, add WHERE clauses:

```sql
-- filterFacility=true
WHERE (json_extract(auction_data, '$.포함') IS NOT NULL
       AND json_extract(auction_data, '$.포함') != '')
   OR (json_extract(auction_data, '$.저촉') IS NOT NULL
       AND json_extract(auction_data, '$.저촉') != '')

-- facilityType="도로" (additional filter)
AND (json_extract(auction_data, '$.포함') LIKE '%도로%'
     OR json_extract(auction_data, '$.저촉') LIKE '%도로%')
```

Add a new function to extract facility type counts for the filter pills:

```typescript
export async function getFacilityTypeCounts(): Promise<{ type: string; count: number }[]>
```

This queries all 포함/저촉 items, parses the facility names, extracts the type suffix (after " — "), and returns aggregated counts.

**File:** `web/src/app/api/signal-top/route.ts`

Add query params: `filter_facility` and `facility_type`. Pass through to `getPropertyScores()`.

### New Component

**File:** `web/src/components/auction/CompensationTab.tsx`

New component that renders:

1. **Stats bar** — total 포함/저촉 items, 보상 단계 count, 미집행 count
2. **Facility type filter pills** — auto-extracted from data via `getFacilityTypeCounts()`. Shows "전체 N", "도로 N", "공원 N", etc. with counts. Active pill is highlighted.
3. **Sort/filter controls** — sort by: 점수순, 경과연수순, 사업단계순. Filters: 포함만, 미집행만.
4. **Card list** — reuses the card layout pattern from SignalTopTab with one addition: a highlighted facility info section showing the 포함/저촉 type, facility name, execution status, and age prominently.
5. **Pagination** — reuses existing Pagination component.

**Styling:** `web/src/components/auction/CompensationTab.module.css` — follows existing CSS module patterns. The facility highlight section uses a darker background to make it the visual hero.

### Tab Registration

**File:** `web/src/components/auction/AuctionPageClient.tsx`

- Add `"compensation"` to `TabId` union type
- Add `{ id: "compensation", label: "보상 후보" }` to tabs array
- Dynamic import: `const CompensationTab = dynamic(() => import("./CompensationTab"), { ssr: false })`
- Render: `{activeTab === "compensation" && <CompensationTab />}`

### UI Updates for Scoring Change

**File:** `web/src/components/auction/SignalTopTab.tsx`

- Remove `price_attractiveness` / "가격매력" from the `breakdownGrid` rendering (the 5-bar score breakdown becomes 4 bars)
- Remove `price_ratio` from sort options
- Keep price display in card (감정평가액, 최저매각가격, 공시지가비율) as informational — just not scored

**File:** `web/src/app/api/signal-top/precompute/route.ts`

- Remove `minToOfficialRatio` from the scoring input passed to `scoreItem()`
- The column still exists in auction_data for display, just not used in scoring

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/scoring/config.ts` | **Modify** | Remove price_attractiveness, reweight to 40/30/15/15 |
| `lib/scoring/engine.ts` | **Modify** | Remove price scoring function and references |
| `lib/minutes/cache/signals.ts` | **Modify** | Add filterFacility/facilityType query options, add getFacilityTypeCounts() |
| `app/api/signal-top/route.ts` | **Modify** | Accept filter_facility and facility_type params |
| `app/api/signal-top/precompute/route.ts` | **Modify** | Remove minToOfficialRatio from scoring input |
| `components/auction/AuctionPageClient.tsx` | **Modify** | Add 4th tab "보상 후보" |
| `components/auction/SignalTopTab.tsx` | **Modify** | Remove price_attractiveness from breakdown display and sort |
| `components/auction/CompensationTab.tsx` | **Create** | New tab component |
| `components/auction/CompensationTab.module.css` | **Create** | New tab styles |

## Out of Scope

- New crawling or external API calls
- Changes to the precompute pipeline logic (beyond removing price from scoring input)
- Changes to the 회의록 검색 tab
- Changes to the 경매 목록 search tab
- New database tables
