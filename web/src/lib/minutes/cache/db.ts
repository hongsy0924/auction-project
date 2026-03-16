/**
 * Shared SQLite database layer for the minutes cache system.
 * Provides connection management, async wrappers, schema initialization,
 * and cross-table cleanup operations.
 */
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const CACHE_DB_PATH = process.env.MINUTES_CACHE_PATH ||
    path.join(process.cwd(), "database/minutes_cache.db");

// TTL constants (milliseconds)
export const SEARCH_TTL = 24 * 60 * 60 * 1000;   // 24 hours
export const DETAIL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (historical data rarely changes)
export const EMBEDDING_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SIGNAL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
export const LURIS_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
export const EUM_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
export const EUM_RESTRICTION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SCORES_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
export const GOSI_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

let db: sqlite3.Database | null = null;
let initialized = false;

export function getDb(): sqlite3.Database {
    if (db) return db;

    const dir = path.dirname(CACHE_DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new sqlite3.Database(CACHE_DB_PATH);
    return db;
}

export function runAsync(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export function getAsync<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row as T | undefined);
        });
    });
}

export function allAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []) as T[]);
        });
    });
}

export async function ensureInitialized(): Promise<void> {
    if (initialized) return;

    await runAsync(`CREATE TABLE IF NOT EXISTS search_cache (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS detail_cache (
        docid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS embedding_cache (
        chunk_hash TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS region_signals (
        council_code TEXT NOT NULL,
        dong_name TEXT NOT NULL DEFAULT '',
        keyword TEXT NOT NULL,
        signal_summary TEXT,
        doc_ids TEXT,
        doc_count INTEGER DEFAULT 0,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (council_code, dong_name, keyword)
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS luris_cache (
        pnu TEXT PRIMARY KEY,
        facilities TEXT,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS eum_notices (
        area_cd TEXT PRIMARY KEY,
        notices TEXT NOT NULL,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS eum_permits (
        area_cd TEXT PRIMARY KEY,
        permits TEXT NOT NULL,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS eum_restrictions (
        area_cd TEXT PRIMARY KEY,
        restrictions TEXT NOT NULL,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS property_scores (
        doc_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        dong TEXT DEFAULT '',
        pnu TEXT DEFAULT '',
        sido TEXT DEFAULT '',
        sigungu TEXT DEFAULT '',
        score INTEGER NOT NULL DEFAULT 0,
        signal_count INTEGER DEFAULT 0,
        signal_keywords TEXT,
        facility_count INTEGER DEFAULT 0,
        has_unexecuted INTEGER DEFAULT 0,
        has_compensation INTEGER DEFAULT 0,
        signal_details TEXT,
        facility_details TEXT,
        notice_count INTEGER DEFAULT 0,
        permit_count INTEGER DEFAULT 0,
        restriction_count INTEGER DEFAULT 0,
        has_pnu_match INTEGER DEFAULT 0,
        notice_details TEXT,
        permit_details TEXT,
        restriction_details TEXT,
        auction_data TEXT,
        batch_id TEXT,
        scored_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS property_analysis (
        doc_id TEXT PRIMARY KEY,
        analysis_markdown TEXT NOT NULL,
        analyzed_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS gosi_match_cache (
        doc_id TEXT NOT NULL,
        gosi_title TEXT NOT NULL,
        gosi_stage INTEGER NOT NULL DEFAULT 0,
        ntc_date TEXT,
        match_type TEXT,
        area_cd TEXT,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (doc_id, gosi_title)
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS hot_zone_alerts (
        alert_id TEXT PRIMARY KEY,
        zone_title TEXT NOT NULL,
        zone_stage INTEGER NOT NULL DEFAULT 0,
        zone_area_cd TEXT,
        zone_dong_names TEXT,
        matched_doc_ids TEXT,
        created_at INTEGER NOT NULL,
        reviewed INTEGER DEFAULT 0
    )`);

    initialized = true;
}

export function hashText(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

export function makeCacheKey(keyword: string, councilCode?: string): string {
    return hashText(`${keyword}||${councilCode || ""}`);
}

// --- Cleanup ---

export async function cleanExpiredCache(): Promise<void> {
    await ensureInitialized();
    const now = Date.now();
    await runAsync("DELETE FROM search_cache WHERE ? - created_at > ?", [now, SEARCH_TTL]);
    await runAsync("DELETE FROM detail_cache WHERE ? - created_at > ?", [now, DETAIL_TTL]);
    await runAsync("DELETE FROM embedding_cache WHERE ? - created_at > ?", [now, EMBEDDING_TTL]);
    await runAsync("DELETE FROM region_signals WHERE ? - last_updated > ?", [now, SIGNAL_TTL]);
    await runAsync("DELETE FROM luris_cache WHERE ? - last_updated > ?", [now, LURIS_TTL]);
    await runAsync("DELETE FROM eum_notices WHERE ? - last_updated > ?", [now, EUM_TTL]);
    await runAsync("DELETE FROM eum_permits WHERE ? - last_updated > ?", [now, EUM_TTL]);
    await runAsync("DELETE FROM eum_restrictions WHERE ? - last_updated > ?", [now, EUM_RESTRICTION_TTL]);
    await runAsync("DELETE FROM property_scores WHERE ? - scored_at > ?", [now, SCORES_TTL]);
}

export async function clearUpstreamCaches(): Promise<void> {
    await ensureInitialized();
    await runAsync("DELETE FROM eum_notices");
    await runAsync("DELETE FROM eum_permits");
    await runAsync("DELETE FROM eum_restrictions");
    await runAsync("DELETE FROM region_signals");
    await runAsync("DELETE FROM luris_cache");
}
