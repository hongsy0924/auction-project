/**
 * Database helper — centralizes SQLite access for the auction viewer.
 * Provides connection management and reusable query functions.
 */
import Database from "better-sqlite3";
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

/**
 * Open the auction database in readonly mode.
 * Throws a descriptive error if the DB file doesn't exist.
 */
export function getDb(): Database.Database {
    if (!fs.existsSync(DB_PATH)) {
        throw new Error(`DB 파일이 존재하지 않습니다: ${DB_PATH}`);
    }
    return new Database(DB_PATH, { readonly: true });
}

/** Result shape returned by `searchAuctions`. */
export interface AuctionSearchResult {
    data: Record<string, unknown>[];
    total: number;
}

/**
 * Search auction_list_cleaned by keyword with pagination.
 *
 * @param keyword - search term (matched against all SEARCH_COLUMNS via LIKE)
 * @param page    - 1-based page number
 * @param perPage - rows per page
 */
export function searchAuctions(
    keyword: string,
    page: number,
    perPage: number
): AuctionSearchResult {
    const db = getDb();

    try {
        const offset = (page - 1) * perPage;

        let where = "";
        let params: string[] = [];

        if (keyword) {
            where =
                "WHERE " +
                SEARCH_COLUMNS.map((col) => `"${col}" LIKE ?`).join(" OR ");
            params = Array(SEARCH_COLUMNS.length).fill(`%${keyword}%`);
        }

        const totalRow = db
            .prepare(`SELECT COUNT(*) as cnt FROM "${TABLE_NAME}" ${where}`)
            .get(...params) as { cnt: number };

        const rows = db
            .prepare(
                `SELECT * FROM "${TABLE_NAME}" ${where} LIMIT ? OFFSET ?`
            )
            .all(...params, perPage, offset) as Record<string, unknown>[];

        return { data: rows, total: totalRow.cnt };
    } finally {
        db.close();
    }
}
