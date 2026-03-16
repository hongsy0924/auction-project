/**
 * Cache operations for EUM (토지이음) and LURIS data:
 * luris_cache, eum_notices, eum_permits, eum_restrictions.
 */
import {
    runAsync, getAsync, ensureInitialized,
    LURIS_TTL, EUM_TTL, EUM_RESTRICTION_TTL,
} from "./db";

// --- LURIS Cache ---

export interface CachedLurisFacility {
    facilityName: string;
    facilityType: string;
    decisionDate?: string;
    executionStatus?: string;
}

export async function getCachedLuris(pnu: string): Promise<CachedLurisFacility[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ facilities: string; last_updated: number }>(
        "SELECT facilities, last_updated FROM luris_cache WHERE pnu = ?",
        [pnu]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > LURIS_TTL) {
        await runAsync("DELETE FROM luris_cache WHERE pnu = ?", [pnu]);
        return null;
    }
    return JSON.parse(row.facilities);
}

export async function setCachedLuris(pnu: string, facilities: CachedLurisFacility[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO luris_cache (pnu, facilities, last_updated) VALUES (?, ?, ?)",
        [pnu, JSON.stringify(facilities), Date.now()]
    );
}

// --- EUM Cache (토지이음) ---

export interface CachedEumNotice {
    title: string;
    noticeType: string;
    noticeDate: string;
    areaCd: string;
    relatedPnu?: string;
    relatedAddress?: string;
}

export interface CachedEumPermit {
    projectName: string;
    permitType: string;
    permitDate: string;
    areaCd: string;
    area?: string;
}

export interface CachedEumRestriction {
    zoneName: string;
    restrictionType: string;
    description: string;
    areaCd: string;
}

export async function getCachedEumNotices(areaCd: string): Promise<CachedEumNotice[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ notices: string; last_updated: number }>(
        "SELECT notices, last_updated FROM eum_notices WHERE area_cd = ?",
        [areaCd]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > EUM_TTL) {
        await runAsync("DELETE FROM eum_notices WHERE area_cd = ?", [areaCd]);
        return null;
    }
    return JSON.parse(row.notices);
}

export async function setCachedEumNotices(areaCd: string, notices: CachedEumNotice[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO eum_notices (area_cd, notices, last_updated) VALUES (?, ?, ?)",
        [areaCd, JSON.stringify(notices), Date.now()]
    );
}

export async function getCachedEumPermits(areaCd: string): Promise<CachedEumPermit[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ permits: string; last_updated: number }>(
        "SELECT permits, last_updated FROM eum_permits WHERE area_cd = ?",
        [areaCd]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > EUM_TTL) {
        await runAsync("DELETE FROM eum_permits WHERE area_cd = ?", [areaCd]);
        return null;
    }
    return JSON.parse(row.permits);
}

export async function setCachedEumPermits(areaCd: string, permits: CachedEumPermit[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO eum_permits (area_cd, permits, last_updated) VALUES (?, ?, ?)",
        [areaCd, JSON.stringify(permits), Date.now()]
    );
}

export async function getCachedEumRestrictions(areaCd: string): Promise<CachedEumRestriction[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ restrictions: string; last_updated: number }>(
        "SELECT restrictions, last_updated FROM eum_restrictions WHERE area_cd = ?",
        [areaCd]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > EUM_RESTRICTION_TTL) {
        await runAsync("DELETE FROM eum_restrictions WHERE area_cd = ?", [areaCd]);
        return null;
    }
    return JSON.parse(row.restrictions);
}

export async function setCachedEumRestrictions(areaCd: string, restrictions: CachedEumRestriction[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO eum_restrictions (area_cd, restrictions, last_updated) VALUES (?, ?, ?)",
        [areaCd, JSON.stringify(restrictions), Date.now()]
    );
}
