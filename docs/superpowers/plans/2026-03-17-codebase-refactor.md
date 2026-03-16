# Codebase Refactoring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the auction-project codebase by adding safety nets (tests), fixing data integrity risks (cache, precompute atomicity), eliminating dead config, and decomposing oversized modules — all without breaking existing functionality.

**Architecture:** The project is a dual-system: Python crawler feeds data into SQLite, Next.js frontend reads it for scoring and display. Changes are organized so each task is independently testable and deployable. We add tests FIRST (safety net), then refactor with confidence.

**Tech Stack:** Python 3.11+, Next.js 16 (App Router, React 19), SQLite3, Vitest (new), pytest (existing)

---

## Chunk 1: Safety Nets — Scoring Engine Tests

The scoring engine (`web/src/lib/scoring/`) is the core business logic with ZERO test coverage. We must add tests before touching anything else. This is the single most important task.

### Task 1: Set Up Vitest in web/

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`

- [ ] **Step 1: Install vitest and dependencies**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `web/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        globals: true,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
});
```

- [ ] **Step 3: Add test script to package.json**

In `web/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run
```
Expected: "No test files found" (not an error)

- [ ] **Step 5: Update root Makefile to include frontend tests**

In `Makefile`, change the `test` target:
```makefile
test:
	@echo "Running backend unit tests..."
	cd crawler && pytest -m "not real_api"
	@echo "Running frontend unit tests..."
	cd web && npm test
```

- [ ] **Step 6: Commit**

```bash
git add web/vitest.config.ts web/package.json web/package-lock.json Makefile
git commit -m "chore: add vitest to web/ for frontend testing"
```

---

### Task 2: Test the Scoring Engine — Core Logic

**Files:**
- Create: `web/src/lib/scoring/__tests__/engine.test.ts`
- Reference: `web/src/lib/scoring/engine.ts` (DO NOT MODIFY)
- Reference: `web/src/lib/scoring/config.ts` (DO NOT MODIFY)

These tests pin the current scoring behavior. Every single scoring function gets a test.

- [ ] **Step 1: Write scoring engine tests**

Create `web/src/lib/scoring/__tests__/engine.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringInput } from "../engine";

describe("calculateScore", () => {
    it("returns 0 for completely empty input", () => {
        const result = calculateScore({});
        expect(result.total).toBe(0);
    });

    it("scores facility_coverage: 포함 = 1.0 raw", () => {
        const result = calculateScore({ facilityInclude: "도로" });
        expect(result.components.facility_coverage.raw).toBe(1.0);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.2); // 1.0 * 0.20
    });

    it("scores facility_coverage: 저촉 = 0.7 raw", () => {
        const result = calculateScore({ facilityConflict: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.7);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.14);
    });

    it("scores facility_coverage: 접합 = 0.3 raw", () => {
        const result = calculateScore({ facilityAdjoin: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.3);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.06);
    });

    it("takes max when multiple coverage types exist", () => {
        const result = calculateScore({
            facilityInclude: "공원",
            facilityConflict: "도로",
        });
        // 포함 (1.0) > 저촉 (0.7) → takes 1.0
        expect(result.components.facility_coverage.raw).toBe(1.0);
    });

    it("ignores whitespace-only facility strings", () => {
        const result = calculateScore({ facilityInclude: "   " });
        expect(result.components.facility_coverage.raw).toBe(0);
    });

    it("scores facility_age tiers correctly", () => {
        // 18+ years = 1.0
        expect(calculateScore({ facilityAgeYears: 20 }).components.facility_age.raw).toBe(1.0);
        // 15-17 years = 0.8
        expect(calculateScore({ facilityAgeYears: 16 }).components.facility_age.raw).toBe(0.8);
        // 10-14 years = 0.5
        expect(calculateScore({ facilityAgeYears: 12 }).components.facility_age.raw).toBe(0.5);
        // 5-9 years = 0.2
        expect(calculateScore({ facilityAgeYears: 7 }).components.facility_age.raw).toBe(0.2);
        // 0-4 years = 0.1
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

    it("scores price_attractiveness tiers", () => {
        // ratio ≤ 0.5 = 1.0
        expect(calculateScore({ minToOfficialRatio: 0.3 }).components.price_attractiveness.raw).toBe(1.0);
        // ratio ≤ 0.7 = 0.7
        expect(calculateScore({ minToOfficialRatio: 0.6 }).components.price_attractiveness.raw).toBe(0.7);
        // ratio ≤ 0.9 = 0.4
        expect(calculateScore({ minToOfficialRatio: 0.85 }).components.price_attractiveness.raw).toBe(0.4);
        // ratio ≤ 1.2 = 0.1
        expect(calculateScore({ minToOfficialRatio: 1.1 }).components.price_attractiveness.raw).toBe(0.1);
        // ratio > 1.2 = 0
        expect(calculateScore({ minToOfficialRatio: 1.5 }).components.price_attractiveness.raw).toBe(0);
    });

    it("scores price_attractiveness: null/0 → 0", () => {
        expect(calculateScore({ minToOfficialRatio: null }).components.price_attractiveness.raw).toBe(0);
        expect(calculateScore({ minToOfficialRatio: 0 }).components.price_attractiveness.raw).toBe(0);
    });

    it("scores timing: yuchalCount capped at 0.6", () => {
        expect(calculateScore({ yuchalCount: 1 }).components.timing.raw).toBeCloseTo(0.15);
        expect(calculateScore({ yuchalCount: 3 }).components.timing.raw).toBeCloseTo(0.45);
        expect(calculateScore({ yuchalCount: 5 }).components.timing.raw).toBeCloseTo(0.6); // capped
        expect(calculateScore({ yuchalCount: 10 }).components.timing.raw).toBeCloseTo(0.6); // still capped
    });

    it("composite score sums weighted components", () => {
        const input: ScoringInput = {
            facilityInclude: "도로",      // raw=1.0, weighted=0.20
            facilityAgeYears: 20,         // raw=1.0, weighted=0.10
            gosiStage: 4,                 // raw=1.0, weighted=0.30
            minToOfficialRatio: 0.3,      // raw=1.0, weighted=0.25
            yuchalCount: 5,               // raw=0.6, weighted=0.09
        };
        const result = calculateScore(input);
        // 0.20 + 0.10 + 0.30 + 0.25 + 0.09 = 0.94
        expect(result.total).toBeCloseTo(0.94, 2);
    });

    it("total is rounded to 3 decimal places", () => {
        const result = calculateScore({ facilityConflict: "도로", yuchalCount: 1 });
        // 0.7*0.20 + 0.15*0.15 = 0.14 + 0.0225 = 0.1625 → rounds to 0.163
        const totalStr = result.total.toString();
        const decimals = totalStr.split(".")[1] || "";
        expect(decimals.length).toBeLessThanOrEqual(3);
    });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run
```
Expected: All tests PASS (these test existing behavior, not new code)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/scoring/__tests__/engine.test.ts
git commit -m "test: add comprehensive scoring engine tests (17 cases)"
```

---

## Chunk 2: Safety Nets — Python Config & Precompute Tests

### Task 3: Verify Which Config Module Is Actually Used

Before deleting `config.py`, confirm what imports it.

**Files:**
- Reference: `crawler/config.py` (will be deleted in Task 4)
- Reference: `crawler/src/settings.py` (canonical config)

- [ ] **Step 1: Search for all imports of `config.py`**

```bash
cd /Users/soonyoung/Desktop/auction-project && grep -rn "from config import\|import config\|from crawler.config" crawler/ --include="*.py" | grep -v __pycache__ | grep -v .pyc
```

Note every file that imports from `config.py`. These must be migrated to `settings.py`.

- [ ] **Step 2: Search for all imports of `settings.py`**

```bash
cd /Users/soonyoung/Desktop/auction-project && grep -rn "from.*settings import\|import.*settings\|get_settings" crawler/ --include="*.py" | grep -v __pycache__ | grep -v .pyc
```

Document which files already use `settings.py`.

- [ ] **Step 3: Verify `pnu_generator.py` dependency**

`pnu_generator.py:123-124` imports `API_CONFIG` from `config.py`:
```python
self.base_url = API_CONFIG['vworld_url']
self.api_key = API_CONFIG['vworld_api_key']
```

This is the critical import to migrate. Verify:
```bash
cd /Users/soonyoung/Desktop/auction-project && grep -n "API_CONFIG\|CRAWLING_CONFIG\|BROWSER_CONFIG\|FILE_CONFIG\|CACHE_CONFIG\|COUNCIL_API_CONFIG" crawler/ -r --include="*.py" | grep -v __pycache__
```

---

### Task 4: Delete `config.py` and Migrate to `settings.py`

**Files:**
- Delete: `crawler/config.py`
- Modify: `crawler/pnu_generator.py:122-124` (imports `API_CONFIG`)
- Modify: `crawler/tests/test_api_response.py` (imports `API_CONFIG`)
- Modify: `crawler/tests/test_real_api.py` (imports `API_CONFIG`)
- Modify: `crawler/tests/test_auction_api_response.py` (imports `API_CONFIG`, `CRAWLING_CONFIG`)
- Modify: `crawler/scripts/fetch_council_minutes.py` (imports `COUNCIL_API_CONFIG` — NOTE: references `COUNCIL_API_CONFIG['timeout']` which doesn't exist in config.py; this is a pre-existing bug)
- Modify: `crawler/scripts/index_region_signals.py` (imports `COUNCIL_API_CONFIG`)
- Modify: `crawler/scripts/analyze_urban_planning.py` (imports `AI_CONFIG` — NOTE: `AI_CONFIG` doesn't exist in config.py; this is a pre-existing bug, script is likely broken)
- Reference: `crawler/src/settings.py`

**Pre-existing bugs found during audit:**
- `scripts/analyze_urban_planning.py` imports `AI_CONFIG` which doesn't exist in `config.py`. This script is already broken. We will NOT fix it — just update its import to `settings.py` and add a `TODO` comment.
- `scripts/fetch_council_minutes.py` references `COUNCIL_API_CONFIG['timeout']` which doesn't exist. Same treatment.

- [ ] **Step 1: Add `council_api_key` to `settings.py`**

`config.py` has `COUNCIL_API_CONFIG` with `base_url` and `api_key`. These need equivalents in `settings.py`. In `crawler/src/settings.py`, add to `ApiSettings`:
```python
    council_api_url: str = "https://clik.nanet.go.kr/openapi/minutes.do"
    council_api_key: str = ""

    def __post_init__(self) -> None:
        self.vworld_api_key = os.getenv('VWORLD_API_KEY', self.vworld_api_key)
        self.council_api_key = os.getenv('CLIK_API_KEY', self.council_api_key)
```

- [ ] **Step 2: Write a settings test**

Create `crawler/tests/test_settings.py`:
```python
"""Verify settings singleton works and all config values are accessible."""
from src.settings import get_settings


def test_settings_singleton():
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2


def test_vworld_key_accessible():
    s = get_settings()
    assert hasattr(s.api, "vworld_api_key")
    assert hasattr(s.api, "vworld_url")


def test_council_api_accessible():
    s = get_settings()
    assert hasattr(s.api, "council_api_url")
    assert hasattr(s.api, "council_api_key")


def test_crawling_defaults():
    s = get_settings()
    assert s.crawling.page_size > 0
    assert s.crawling.request_delay > 0
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd /Users/soonyoung/Desktop/auction-project/crawler && pytest tests/test_settings.py -v
```
Expected: PASS

- [ ] **Step 4: Update `pnu_generator.py` to use `settings.py`**

In `crawler/pnu_generator.py`, find:
```python
from config import API_CONFIG
```

Replace with:
```python
from src.settings import get_settings
```

Then in `PNUGenerator.__init__` (around line 122-124), find:
```python
self.base_url = API_CONFIG['vworld_url']
self.api_key = API_CONFIG['vworld_api_key']
```

Replace with:
```python
_settings = get_settings()
self.base_url = _settings.api.vworld_url
self.api_key = _settings.api.vworld_api_key
```

- [ ] **Step 5: Update test files importing from `config.py`**

For each test file:
- `tests/test_api_response.py`: Replace `from config import API_CONFIG` → `from src.settings import get_settings`; replace `API_CONFIG['vworld_api_key']` → `get_settings().api.vworld_api_key`, etc.
- `tests/test_real_api.py`: Same migration.
- `tests/test_auction_api_response.py`: Same migration. Replace `CRAWLING_CONFIG['key']` → `get_settings().crawling.key`.

- [ ] **Step 6: Update script files importing from `config.py`**

For each script:
- `scripts/index_region_signals.py`: Replace `COUNCIL_API_CONFIG['api_key']` → `get_settings().api.council_api_key`, `COUNCIL_API_CONFIG['base_url']` → `get_settings().api.council_api_url`.
- `scripts/fetch_council_minutes.py`: Same. Add `# TODO: timeout was never defined in config.py — pre-existing bug` where it references `['timeout']`.
- `scripts/analyze_urban_planning.py`: Replace import, add `# TODO: AI_CONFIG never existed — this script needs a rewrite to work`.

- [ ] **Step 7: Run ALL existing tests to verify nothing breaks**

```bash
cd /Users/soonyoung/Desktop/auction-project/crawler && pytest -m "not real_api" -v
```
Expected: ALL PASS

- [ ] **Step 8: Delete `config.py`**

```bash
rm /Users/soonyoung/Desktop/auction-project/crawler/config.py
```

- [ ] **Step 9: Run tests again to confirm no imports break**

```bash
cd /Users/soonyoung/Desktop/auction-project/crawler && pytest -m "not real_api" -v
```
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
git add crawler/config.py crawler/pnu_generator.py crawler/tests/ crawler/scripts/ crawler/src/settings.py
git commit -m "refactor: remove config.py, consolidate all config into settings.py

Migrated 7 files that imported from config.py.
Added council_api_url and council_api_key to ApiSettings.
Documented 2 pre-existing bugs in scripts/ (AI_CONFIG, timeout)."
```

---

## Chunk 3: Fix SSL and Precompute Atomicity

### Task 5: Enable SSL on VWorld API Calls

**Files:**
- Modify: `crawler/pnu_generator.py` (4 occurrences: lines 259, 285, 325, 396)
- Modify: `crawler/src/storage.py` (1 occurrence: line 123)
- Modify: `crawler/tests/test_api_response.py` (4 occurrences: lines 38, 41, 50, 59, 68)
- Modify: `crawler/tests/test_auction_api_response.py` (2 occurrences: lines 51, 60)
- Modify: `crawler/tests/test_real_api.py` (1 occurrence: line 46)

**Total: 12 occurrences across 5 files.** The test files are `real_api` tests that make actual network calls — they also need SSL enabled for consistency.

- [ ] **Step 1: Find all SSL bypass locations**

```bash
cd /Users/soonyoung/Desktop/auction-project && grep -n "ssl=False\|ssl = False" crawler/ -r --include="*.py"
```

- [ ] **Step 2: Remove `ssl=False` from all aiohttp calls in `pnu_generator.py`**

In `crawler/pnu_generator.py`, find every occurrence of `ssl=False` and remove the parameter entirely. For `TCPConnector(ssl=False)`, change to `TCPConnector()`.

For example, if line reads:
```python
async with session.get(self.base_url, params=params, ssl=False) as response:
```
Change to:
```python
async with session.get(self.base_url, params=params) as response:
```

And if connector reads:
```python
aiohttp.TCPConnector(ssl=False)
```
Change to:
```python
aiohttp.TCPConnector()
```

- [ ] **Step 3: Remove `ssl=False` from `storage.py`**

In `crawler/src/storage.py` line 123, find `aiohttp.TCPConnector(ssl=False)` and change to `aiohttp.TCPConnector()`.

- [ ] **Step 4: Remove `ssl=False` from test files**

These are `real_api` tests that make actual network calls:
- `crawler/tests/test_api_response.py` — 4 occurrences (lines 38, 41, 50, 59, 68)
- `crawler/tests/test_auction_api_response.py` — 2 occurrences (lines 51, 60)
- `crawler/tests/test_real_api.py` — 1 occurrence (line 46)

Same pattern: remove `ssl=False` parameter or change `TCPConnector(ssl=False)` to `TCPConnector()`.

- [ ] **Step 5: Run existing PNU tests**

```bash
cd /Users/soonyoung/Desktop/auction-project/crawler && pytest tests/test_pnu_generator.py -v
```
Expected: ALL PASS (unit tests mock aiohttp, no actual SSL calls)

- [ ] **Step 6: Commit**

```bash
git add crawler/pnu_generator.py crawler/src/storage.py crawler/tests/test_api_response.py crawler/tests/test_auction_api_response.py crawler/tests/test_real_api.py
git commit -m "fix: enable SSL verification on all aiohttp calls (12 occurrences across 5 files)"
```

---

### Task 6: Make Precompute Atomic (Transaction Safety)

**Files:**
- Modify: `web/src/lib/minutes/cache.ts:615-618` (clearPropertyScores)
- Modify: `web/src/app/api/signal-top/precompute/route.ts:194-196`

The current flow: `clearPropertyScores()` (DELETE all) → loop scoring items one-by-one. If crash occurs mid-loop, the scores table is empty. Fix: write to a new batch, then swap.

- [ ] **Step 1: Add batch-aware clear and swap to cache.ts**

In `web/src/lib/minutes/cache.ts`, find:
```typescript
export async function clearPropertyScores(): Promise<void> {
    await ensureInitialized();
    await runAsync("DELETE FROM property_scores");
}
```

Replace with:
```typescript
export async function clearPropertyScores(excludeBatchId?: string): Promise<void> {
    await ensureInitialized();
    if (excludeBatchId) {
        // Delete old scores, keep the new batch
        await runAsync("DELETE FROM property_scores WHERE batch_id != ?", [excludeBatchId]);
    } else {
        await runAsync("DELETE FROM property_scores");
    }
}
```

- [ ] **Step 2: Update precompute route to use batch-aware clear**

In `web/src/app/api/signal-top/precompute/route.ts`, find (around line 194-197):
```typescript
    // Clear previous scores
    console.log(`[Precompute] Clearing previous scores...`);
    await clearPropertyScores();
    console.log(`[Precompute] Scores cleared. Starting scoring...`);
```

Replace with:
```typescript
    // NOTE: We do NOT clear scores up front. Instead, we write all new scores
    // with the current batchId, then delete old scores at the end.
    // This ensures the UI always has data even if precompute crashes mid-run.
    console.log(`[Precompute] Starting scoring (batch=${batchId}). Old scores remain until complete.`);
```

Then at the very end of `processAllItems()`, after the hot zone alerts block (after line ~405), find:
```typescript
    console.log(
        `[Precompute] Batch ${batchId} complete. Scored: ${scoredCount}/${allItems.length} (resolved=${resolvedCount}, regions=${signalCache.size}, eumAreas=${eumCache.size})`
    );
```

Add BEFORE that log line:
```typescript
    // Atomically swap: delete old scores now that new batch is complete
    if (scoredCount > 0) {
        await clearPropertyScores(batchId);
        console.log(`[Precompute] Old scores cleared. Batch ${batchId} is now live.`);
    } else {
        console.warn(`[Precompute] No items scored — keeping old scores as fallback.`);
    }
```

- [ ] **Step 3: Run TypeScript type check**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Run scoring engine tests to ensure nothing breaks**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/minutes/cache.ts web/src/app/api/signal-top/precompute/route.ts
git commit -m "fix: make precompute atomic — write new batch before clearing old scores"
```

---

## Chunk 4: Cache Coherency Fixes

### Task 7: Add TTL to Property Scores Cache

**Files:**
- Modify: `web/src/lib/minutes/cache.ts:667-678` (cleanExpiredCache)

- [ ] **Step 1: Add SCORES_TTL constant**

In `web/src/lib/minutes/cache.ts`, after line 20 (`const EUM_RESTRICTION_TTL = ...`), add:
```typescript
const SCORES_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
```

- [ ] **Step 2: Add property_scores cleanup to `cleanExpiredCache()`**

In `web/src/lib/minutes/cache.ts`, find the `cleanExpiredCache` function (line 667-678). After the last `await runAsync` for eum_restrictions, add:
```typescript
    await runAsync("DELETE FROM property_scores WHERE ? - scored_at > ?", [now, SCORES_TTL]);
```

- [ ] **Step 3: Verify no type errors**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/minutes/cache.ts
git commit -m "fix: add 7-day TTL to property_scores cache in cleanExpiredCache()"
```

---

### Task 8: Add `--refresh` Mode to Precompute

**Files:**
- Modify: `web/src/app/api/signal-top/precompute/route.ts`

When calling precompute with `?refresh=true`, clear upstream EUM/LURIS/signal caches before re-scoring. This ensures fresh API data.

- [ ] **Step 1: Add refresh parameter parsing**

In `web/src/app/api/signal-top/precompute/route.ts`, in the `POST` function (line 35), after the auth check, add:
```typescript
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "true";
```

Then pass `forceRefresh` to `processAllItems`:
```typescript
    processAllItems(batchId, forceRefresh).catch((err) => {
```

- [ ] **Step 2: Add `clearUpstreamCaches()` to cache.ts**

In `web/src/lib/minutes/cache.ts`, add after `cleanExpiredCache`:
```typescript
export async function clearUpstreamCaches(): Promise<void> {
    await ensureInitialized();
    await runAsync("DELETE FROM eum_notices");
    await runAsync("DELETE FROM eum_permits");
    await runAsync("DELETE FROM eum_restrictions");
    await runAsync("DELETE FROM region_signals");
    await runAsync("DELETE FROM luris_cache");
}
```

- [ ] **Step 3: Update processAllItems in precompute route**

Change the function signature:
```typescript
async function processAllItems(batchId: string, forceRefresh: boolean = false) {
```

Add import in the precompute route:
```typescript
import {
    // ... existing imports ...
    clearUpstreamCaches,
} from "@/lib/minutes/cache";
```

After the `console.log(`[Precompute] Starting batch ${batchId}`);` line, add:
```typescript
    if (forceRefresh) {
        console.log(`[Precompute] Refresh mode: clearing upstream caches...`);
        await clearUpstreamCaches();
        console.log(`[Precompute] Upstream caches cleared.`);
    }
```

- [ ] **Step 3: Verify no type errors**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/minutes/cache.ts web/src/app/api/signal-top/precompute/route.ts
git commit -m "feat: add ?refresh=true mode to precompute for fresh API data"
```

---

## Chunk 5: Environment Variable Validation

### Task 9: Startup Env Var Validation

**Files:**
- Create: `web/src/lib/env.ts`
- Modify: `web/src/app/layout.tsx` (import for side-effect)

- [ ] **Step 1: Create env validation module**

Create `web/src/lib/env.ts`:
```typescript
/**
 * Validate required environment variables at import time.
 * Import this in layout.tsx so it runs on server startup.
 */

interface EnvCheck {
    name: string;
    required: boolean;
    description: string;
}

const ENV_CHECKS: EnvCheck[] = [
    { name: "JWT_SECRET", required: true, description: "JWT signing secret for auth" },
    { name: "ADMIN_USERNAME", required: true, description: "Admin login username" },
    { name: "ADMIN_PASSWORD_HASH", required: true, description: "Admin login password hash" },
    { name: "DATABASE_PATH", required: false, description: "Path to auction_data.db (defaults to ./database/)" },
    { name: "CLIK_API_KEY", required: false, description: "CLIK council minutes API key" },
    { name: "GEMINI_API_KEY", required: false, description: "Gemini LLM API key" },
    { name: "LURIS_API_KEY", required: false, description: "LURIS urban planning API key" },
    { name: "EUM_API_ID", required: false, description: "EUM API ID (토지이음)" },
    { name: "EUM_API_KEY", required: false, description: "EUM API key (토지이음)" },
    { name: "PRECOMPUTE_SECRET", required: false, description: "Bearer token for precompute endpoint" },
];

const missing: string[] = [];
const warnings: string[] = [];

for (const check of ENV_CHECKS) {
    const value = process.env[check.name];
    if (!value) {
        if (check.required) {
            missing.push(`  - ${check.name}: ${check.description}`);
        } else {
            warnings.push(`  - ${check.name}: ${check.description}`);
        }
    }
}

if (warnings.length > 0) {
    console.warn(`[ENV] Optional variables not set (some features will be disabled):\n${warnings.join("\n")}`);
}

if (missing.length > 0) {
    console.error(`[ENV] FATAL: Required environment variables missing:\n${missing.join("\n")}`);
    if (process.env.NODE_ENV === "production") {
        throw new Error(`Missing required env vars: ${missing.map(m => m.split(":")[0].trim().replace("- ", "")).join(", ")}`);
    }
}
```

- [ ] **Step 2: Import in layout.tsx for side-effect**

In `web/src/app/layout.tsx`, add at the very top (before other imports):
```typescript
import "@/lib/env";
```

- [ ] **Step 3: Verify no type errors**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit
```

- [ ] **Step 4: Verify app still starts in dev**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && timeout 10 npx next dev 2>&1 | head -20
```
Expected: Warnings about missing optional vars, no crash (dev mode is lenient)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/env.ts web/src/app/layout.tsx
git commit -m "feat: add startup env var validation with required/optional distinction"
```

---

## Chunk 6: Fix AuthContext Type Mismatch

### Task 10: Fix User Interface and Auth Token Handling

**Files:**
- Modify: `web/src/context/AuthContext.tsx`

- [ ] **Step 1: Read current AuthContext**

Read `web/src/context/AuthContext.tsx` in full. Identify the `User` interface.

- [ ] **Step 2: Fix User interface to match login response**

Current interface (AuthContext.tsx lines 3-6):
```typescript
interface User {
    username: string;
    token: string;    // ← WRONG: login response doesn't include token
}
```

Login response (login/route.ts lines 111-114) sends `{ username, role }`. Token is in httpOnly cookie, not the response body. Fix to:

```typescript
interface User {
    username: string;
    role: string;
}
```

No code references `user.token` anywhere (verified by grep), so this is a safe change.

- [ ] **Step 3: Run type check**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/context/AuthContext.tsx
git commit -m "fix: align User interface with actual login response shape"
```

---

## Chunk 7: Decompose `cache.ts` (774 Lines)

### Task 11: Split cache.ts Into Focused Modules

`cache.ts` handles 12 different cache tables and 3 different concerns (DB connection, schema, CRUD operations for each domain). Split into:
- `cache/db.ts` — SQLite connection, `runAsync`, `getAsync`, `allAsync`, `ensureInitialized`
- `cache/minutes.ts` — search_cache, detail_cache, embedding_cache
- `cache/signals.ts` — region_signals, property_scores, property_analysis, gosi_match_cache, hot_zone_alerts
- `cache/eum.ts` — eum_notices, eum_permits, eum_restrictions, luris_cache
- `cache/index.ts` — re-exports everything (backward compat)

**Files:**
- Create: `web/src/lib/minutes/cache/db.ts`
- Create: `web/src/lib/minutes/cache/minutes.ts`
- Create: `web/src/lib/minutes/cache/signals.ts`
- Create: `web/src/lib/minutes/cache/eum.ts`
- Create: `web/src/lib/minutes/cache/index.ts`
- Delete: `web/src/lib/minutes/cache.ts` (after migration)

**IMPORTANT:** This task has the highest risk of breaking imports. The `index.ts` re-exports ensure all existing import paths (`@/lib/minutes/cache`) continue to work.

- [ ] **Step 1: Create `cache/db.ts` with shared DB utilities**

Extract from `cache.ts` into `cache/db.ts`:
- All imports (`sqlite3`, `path`, `fs`, `crypto`)
- `CACHE_DB_PATH` constant
- ALL TTL constants (`SEARCH_TTL`, `DETAIL_TTL`, `EMBEDDING_TTL`, `SIGNAL_TTL`, `LURIS_TTL`, `EUM_TTL`, `EUM_RESTRICTION_TTL`, `SCORES_TTL`, `GOSI_TTL`)
- `db` and `initialized` variables
- `getDb()`, `runAsync()`, `getAsync()`, `allAsync()` functions
- `ensureInitialized()` function (with ALL CREATE TABLE statements — schema stays centralized)
- `hashText()` and `makeCacheKey()` utility functions
- `cleanExpiredCache()` and `clearUpstreamCaches()` (they operate across all tables)

Export all of the above.

- [ ] **Step 2: Create `cache/minutes.ts`**

Extract search_cache, detail_cache, embedding_cache functions. Import `{ runAsync, getAsync, allAsync, ensureInitialized, getDb }` from `./db`.

- [ ] **Step 3: Create `cache/signals.ts`**

Extract region_signals, property_scores, property_analysis, gosi_match_cache, hot_zone_alerts functions. Import from `./db`.

- [ ] **Step 4: Create `cache/eum.ts`**

Extract luris_cache, eum_notices, eum_permits, eum_restrictions functions. Import from `./db`.

- [ ] **Step 5: Create `cache/index.ts` that re-exports everything**

```typescript
export * from "./db";
export * from "./minutes";
export * from "./signals";
export * from "./eum";
```

- [ ] **Step 6: Delete old `cache.ts`**

```bash
rm web/src/lib/minutes/cache.ts
```

- [ ] **Step 7: Verify ALL imports resolve correctly**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit
```
Expected: No errors. All existing `from "@/lib/minutes/cache"` imports resolve through `cache/index.ts`.

- [ ] **Step 8: Run scoring tests**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run
```
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/minutes/cache/ web/src/lib/minutes/cache.ts
git commit -m "refactor: split cache.ts (774 lines) into 4 focused modules"
```

---

## Chunk 8: Decompose Precompute Route (410 Lines)

### Task 12: Extract Scoring Logic from Precompute Route

The precompute route does too much: auth, EUM pre-indexing, region signal fetching, scoring, hot zone detection, writing results. Extract the scoring-specific logic.

**Files:**
- Create: `web/src/lib/scoring/precompute.ts`
- Modify: `web/src/app/api/signal-top/precompute/route.ts`

- [ ] **Step 1: Extract `scoreAuctionItem()` function**

Create `web/src/lib/scoring/precompute.ts`. Move the scoring block (lines 276-374 of precompute/route.ts) into a standalone function:

```typescript
import { calculateScore } from "./engine";
import type { ScoringInput } from "./engine";

export interface AuctionItemForScoring {
    item: Record<string, unknown>;
    gosiStage: number;
}

export function buildScoringInput(item: Record<string, unknown>, gosiStage: number): ScoringInput {
    return {
        facilityInclude: String(item["포함"] || ""),
        facilityConflict: String(item["저촉"] || ""),
        facilityAdjoin: String(item["접합"] || ""),
        facilityAgeYears: parseFloat(String(item["시설경과연수"] || "0")) || undefined,
        gosiStage,
        minToOfficialRatio: parseFloat(String(item["최저가/공시지가비율"] || "0")) || undefined,
        yuchalCount: parseInt(String(item["유찰회수"] || "0"), 10) || 0,
    };
}

export function scoreItem(item: Record<string, unknown>, gosiStage: number) {
    const input = buildScoringInput(item, gosiStage);
    return calculateScore(input);
}
```

- [ ] **Step 2: Add tests for `buildScoringInput`**

Add to `web/src/lib/scoring/__tests__/engine.test.ts`:
```typescript
import { buildScoringInput } from "../precompute";

describe("buildScoringInput", () => {
    it("extracts scoring fields from auction item", () => {
        const item = {
            "포함": "도로",
            "저촉": "",
            "접합": "",
            "시설경과연수": "15.5",
            "최저가/공시지가비율": "0.45",
            "유찰회수": "3",
        };
        const input = buildScoringInput(item, 2);
        expect(input.facilityInclude).toBe("도로");
        expect(input.facilityAgeYears).toBeCloseTo(15.5);
        expect(input.minToOfficialRatio).toBeCloseTo(0.45);
        expect(input.yuchalCount).toBe(3);
        expect(input.gosiStage).toBe(2);
    });

    it("handles missing/zero values gracefully", () => {
        const item = {};
        const input = buildScoringInput(item, 0);
        expect(input.facilityInclude).toBe("");
        expect(input.facilityAgeYears).toBeUndefined();
        expect(input.minToOfficialRatio).toBeUndefined();
        expect(input.yuchalCount).toBe(0);
    });
});
```

- [ ] **Step 3: Update precompute route to use extracted function**

In `web/src/app/api/signal-top/precompute/route.ts`, add import:
```typescript
import { scoreItem } from "@/lib/scoring/precompute";
```

Replace lines 276-289 (the scoring block) with:
```typescript
            const scoreResult = scoreItem(item, maxGosiStage);
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run && npx tsc --noEmit
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/scoring/precompute.ts web/src/lib/scoring/__tests__/engine.test.ts web/src/app/api/signal-top/precompute/route.ts
git commit -m "refactor: extract scoring logic from precompute route into reusable module"
```

---

## Chunk 9: Dead Code Cleanup

### Task 13: Remove Dead File and Stale TODO References

**Files:**
- Delete: `crawler/src/browser.py` (dead duplicate of `browser_fetcher.py`)
- Modify: `TODO.md` (stale references to deleted files)

**IMPORTANT FINDING:** `browser.py` and `browser_fetcher.py` are IDENTICAL files (same content, same 128 lines). `pipeline.py:13` imports `from src.browser_fetcher import BrowserFetcher` — so `browser_fetcher.py` is the LIVE file and `browser.py` is the dead duplicate. Delete `browser.py`, keep `browser_fetcher.py`.

**NOTE:** `Set` in `pipeline.py` IS actually used (line 28: `self.successful_pages: Set[int]`). Do NOT touch it.

- [ ] **Step 1: Verify browser.py is truly unused**

```bash
cd /Users/soonyoung/Desktop/auction-project && grep -rn "from src.browser import\|from src\.browser import\|import browser" crawler/src/ --include="*.py" | grep -v browser_fetcher | grep -v __pycache__
```
Expected: NO results (nothing imports from `browser.py`)

- [ ] **Step 2: Delete the dead duplicate**

```bash
rm /Users/soonyoung/Desktop/auction-project/crawler/src/browser.py
```

- [ ] **Step 3: Clean up TODO.md**

Read `TODO.md`. The rename items are stale:
- `court_auction_crawler.py → main.py` — already done (file is `src/main.py`)
- `browser_fetcher.py → browser.py` — NOT done and should NOT be done (pipeline.py imports `browser_fetcher`; rename would break imports). Remove this TODO item.
- `Delete deploy.sh and run-crawler.sh` — files no longer exist. Remove.
- `auction-crawler/ → crawler/` — already done. Remove.
- `auction-viewer/ → web/` — already done. Remove.

- [ ] **Step 4: Run tests**

```bash
cd /Users/soonyoung/Desktop/auction-project/crawler && pytest -m "not real_api" -v
```
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add crawler/src/browser.py TODO.md
git commit -m "chore: delete dead browser.py duplicate, clean stale TODO entries"
```

---

## Summary of What This Plan Does NOT Touch

These areas were identified in the analysis but are explicitly deferred:

1. **SignalTopTab.tsx decomposition (572 lines)** — UI refactor needs visual testing; defer to a separate plan with screenshot verification
2. **PropertySignals.tsx SSE hook extraction** — Same reason; needs browser testing
3. **React Error Boundaries** — Needs a design decision on error UI first
4. **`lookup_bjdong_code()` decomposition** — Has 26+ tests but is complex; deserves its own focused plan
5. **Inline styles → CSS modules** — Cosmetic; no functional risk; low priority
6. **Accessibility (ARIA, semantic HTML)** — Important but separate scope
7. **Password hashing (bcrypt)** — Only matters when multi-user is needed
8. **ORM model type tightening** — Would require schema migration; risky for a working system
9. **`pnu_generator.py` error handling refinement** — Needs careful analysis of all callers

These are all documented for future work but intentionally excluded to keep this plan focused and safe.

---

## Execution Order & Dependencies

```
Task 1 (vitest setup) ──→ Task 2 (scoring tests) ──→ all other tasks
Task 3 (config audit) ──→ Task 4 (delete config.py)
Task 5 (SSL fix) — independent
Task 6 (precompute atomicity) — independent
Task 7 (cache TTL) — independent
Task 8 (refresh mode) — depends on Task 7
Task 9 (env validation) — independent
Task 10 (AuthContext fix) — independent
Task 11 (cache.ts split) — independent, but run AFTER Task 7 & 8
Task 12 (precompute extraction) — depends on Task 6, run AFTER Task 11
Task 13 (dead code) — independent
```

**Parallel groups:**
- Group A (independent): Tasks 5, 9, 10, 13
- Group B (sequential): Tasks 1 → 2
- Group C (sequential): Tasks 3 → 4
- Group D (sequential): Tasks 6 → 7 → 8 → 11 → 12

**IMPORTANT — Line number drift:** Tasks in Group D all modify `cache.ts` and `precompute/route.ts`. Line numbers in Tasks 7, 8, 11, 12 reference the ORIGINAL file state. After each task modifies the file, line numbers will shift. When executing, search for the code pattern (the `find` block), not the line number.

**Same-day batch_id edge case:** The precompute `batchId` is `new Date().toISOString().slice(0, 10)` (e.g., `"2026-03-17"`). If precompute runs twice the same day, the second run's new scores have the same batch_id as the first run's scores. The `clearPropertyScores(batchId)` at the end will keep ALL scores from both runs (since they share the batch_id). This is acceptable — duplicate doc_ids are handled by `INSERT OR REPLACE`, so only the latest score per property survives.
