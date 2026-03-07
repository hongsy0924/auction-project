/**
 * Persistent cache layer for minutes search pipeline.
 * Uses SQLite to cache CLIK API responses and Gemini embeddings.
 */
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const CACHE_DB_PATH = process.env.MINUTES_CACHE_PATH ||
    path.join(process.cwd(), "database/minutes_cache.db");

// TTL constants (milliseconds)
const SEARCH_TTL = 24 * 60 * 60 * 1000;   // 24 hours
const DETAIL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (historical data rarely changes)
const EMBEDDING_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

let db: sqlite3.Database | null = null;
let initialized = false;

function getDb(): sqlite3.Database {
    if (db) return db;

    const dir = path.dirname(CACHE_DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new sqlite3.Database(CACHE_DB_PATH);
    return db;
}

function runAsync(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getAsync<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row as T | undefined);
        });
    });
}

function allAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []) as T[]);
        });
    });
}

async function ensureInitialized(): Promise<void> {
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

    initialized = true;
}

export function hashText(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function makeCacheKey(keyword: string, councilCode?: string): string {
    return hashText(`${keyword}||${councilCode || ""}`);
}

// --- Search Cache ---

export async function getCachedSearch(keyword: string, councilCode?: string): Promise<unknown[] | null> {
    await ensureInitialized();
    const key = makeCacheKey(keyword, councilCode);
    const row = await getAsync<{ data: string; created_at: number }>(
        "SELECT data, created_at FROM search_cache WHERE cache_key = ?",
        [key]
    );
    if (!row) return null;
    if (Date.now() - row.created_at > SEARCH_TTL) {
        await runAsync("DELETE FROM search_cache WHERE cache_key = ?", [key]);
        return null;
    }
    return JSON.parse(row.data);
}

export async function setCachedSearch(keyword: string, councilCode: string | undefined, data: unknown[]): Promise<void> {
    await ensureInitialized();
    const key = makeCacheKey(keyword, councilCode);
    await runAsync(
        "INSERT OR REPLACE INTO search_cache (cache_key, data, created_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(data), Date.now()]
    );
}

// --- Detail Cache ---

export async function getCachedDetail(docid: string): Promise<unknown | null> {
    await ensureInitialized();
    const row = await getAsync<{ data: string; created_at: number }>(
        "SELECT data, created_at FROM detail_cache WHERE docid = ?",
        [docid]
    );
    if (!row) return null;
    if (Date.now() - row.created_at > DETAIL_TTL) {
        await runAsync("DELETE FROM detail_cache WHERE docid = ?", [docid]);
        return null;
    }
    return JSON.parse(row.data);
}

export async function setCachedDetail(docid: string, data: unknown): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO detail_cache (docid, data, created_at) VALUES (?, ?, ?)",
        [docid, JSON.stringify(data), Date.now()]
    );
}

// --- Embedding Cache ---

export async function getCachedEmbeddings(chunkHashes: string[]): Promise<Map<string, number[]>> {
    await ensureInitialized();
    const result = new Map<string, number[]>();
    if (chunkHashes.length === 0) return result;

    // Query in batches to avoid SQLite variable limit
    const BATCH = 500;
    for (let i = 0; i < chunkHashes.length; i += BATCH) {
        const batch = chunkHashes.slice(i, i + BATCH);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await allAsync<{ chunk_hash: string; embedding: string; created_at: number }>(
            `SELECT chunk_hash, embedding, created_at FROM embedding_cache WHERE chunk_hash IN (${placeholders})`,
            batch
        );
        const now = Date.now();
        for (const row of rows) {
            if (now - row.created_at <= EMBEDDING_TTL) {
                result.set(row.chunk_hash, JSON.parse(row.embedding));
            }
        }
    }
    return result;
}

export async function setCachedEmbeddings(entries: { hash: string; embedding: number[] }[]): Promise<void> {
    await ensureInitialized();
    if (entries.length === 0) return;

    const now = Date.now();
    const d = getDb();

    return new Promise((resolve, reject) => {
        d.serialize(() => {
            d.run("BEGIN TRANSACTION");
            const stmt = d.prepare(
                "INSERT OR REPLACE INTO embedding_cache (chunk_hash, embedding, created_at) VALUES (?, ?, ?)"
            );
            for (const entry of entries) {
                stmt.run(entry.hash, JSON.stringify(entry.embedding), now);
            }
            stmt.finalize();
            d.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

// --- Cleanup ---

export async function cleanExpiredCache(): Promise<void> {
    await ensureInitialized();
    const now = Date.now();
    await runAsync("DELETE FROM search_cache WHERE ? - created_at > ?", [now, SEARCH_TTL]);
    await runAsync("DELETE FROM detail_cache WHERE ? - created_at > ?", [now, DETAIL_TTL]);
    await runAsync("DELETE FROM embedding_cache WHERE ? - created_at > ?", [now, EMBEDDING_TTL]);
}
