/**
 * Cache operations for council minutes: search results, document details, embeddings.
 */
import {
    runAsync, getAsync, allAsync, getDb, ensureInitialized,
    makeCacheKey, SEARCH_TTL, DETAIL_TTL, EMBEDDING_TTL,
} from "./db";

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
