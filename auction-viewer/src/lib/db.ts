/**
 * Database helper — centralizes SQLite access for the auction viewer.
 * Provides connection management and reusable query functions.
 */
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

/** Absolute path to the SQLite database file. */
export const DB_PATH = path.join(process.cwd(), "database/auction_data.db");

/** Column names (한글) in auction_list_cleaned used for keyword search. */
export const SEARCH_COLUMNS = [
    "사건번호",
    "물건종류",
    "지목",
    "주소",
    "지번",
    "감정평가액",
    "최저매각가격",
    "%",
    "비고",
    "매각기일",
    "유찰회수",
    "매각결정기일",
    "건축물",
    "면적",
    "포함",
    "저촉",
    "접합",
    "토지이용계획및제한상태",
    "담당법원",
    "담당계",
    "전화번호",
] as const;

const TABLE_NAME = "auction_list_cleaned";

// Global variable to hold the database instance in development
// producing a singleton similar to Prisma's recommended pattern for Next.js
let dbInstance: sqlite3.Database | null = null;

function getDatabase(): sqlite3.Database {
    if (dbInstance) {
        return dbInstance;
    }

    if (!fs.existsSync(DB_PATH)) {
        throw new Error(`DB 파일이 존재하지 않습니다: ${DB_PATH}`);
    }

    // Initialize the database connection
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error("Failed to connect to database:", err);
            // If connection fails, ensure we don't keep a broken instance
            dbInstance = null;
        } else {
            console.log("New database connection established.");
        }
    });

    // In development, keep the instance globally
    // In production, you might want different handling, but for SQLite file access,
    // a single connection is usually fine and preferred to avoid locking.
    dbInstance = db;
    return db;
}

/** Result shape returned by `searchAuctions`. */
export interface AuctionSearchResult {
    data: Record<string, unknown>[];
    total: number;
}

/**
 * Search auction_list_cleaned by keyword with pagination.
 * Uses sqlite3 (async).
 */
export function searchAuctions(
    keyword: string,
    page: number,
    perPage: number
): Promise<AuctionSearchResult> {
    return new Promise((resolve, reject) => {
        let db: sqlite3.Database;
        try {
            db = getDatabase();
        } catch (e) {
            return reject(e);
        }

        const offset = (page - 1) * perPage;
        let where = "";
        let params: unknown[] = [];

        if (keyword) {
            where =
                "WHERE " +
                SEARCH_COLUMNS.map((col) => `"${col}" LIKE ?`).join(" OR ");
            params = Array(SEARCH_COLUMNS.length).fill(`%${keyword}%`);
        }

        // Count query
        db.get(
            `SELECT COUNT(*) as cnt FROM "${TABLE_NAME}" ${where}`,
            params,
            (err, row: any) => {
                if (err) {
                    // Do NOT close the global connection
                    return reject(err);
                }
                const total = row?.cnt || 0;

                // Data query
                // params for data query: [...params, perPage, offset]
                db.all(
                    `SELECT * FROM "${TABLE_NAME}" ${where} LIMIT ? OFFSET ?`,
                    [...params, perPage, offset],
                    (err, rows) => {
                        // Do NOT close the global connection
                        if (err) return reject(err);
                        resolve({
                            data: rows as Record<string, unknown>[],
                            total,
                        });
                    }
                );
            }
        );
    });
}
