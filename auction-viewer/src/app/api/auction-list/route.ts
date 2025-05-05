import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), '..', './', 'auction-database', 'database', 'auction_data.db');

console.log('DB_PATH:', DB_PATH);

// 검색 대상 컬럼명(한글 컬럼명)
const SEARCH_COLUMNS = [
  "사건번호", "물건종류", "지목", "주소", "지번", "감정평가액", "최저매각가격", "%", "비고",
  "매각기일", "유찰회수", "매각결정기일", "건축물", "면적", "토지이용계획및제한상태",
  "담당법원", "담당계", "전화번호"
];

export async function GET(req: NextRequest) {
  if (!fs.existsSync(DB_PATH)) {
    return NextResponse.json({ error: `DB 파일이 존재하지 않습니다: ${DB_PATH}` }, { status: 500 });
  }
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    return NextResponse.json({
      error: `DB 디렉토리가 존재하지 않습니다: ${path.dirname(DB_PATH)}`
    }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword')?.trim() ?? '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const perPage = parseInt(searchParams.get('per_page') || '20', 10);
  const offset = (page - 1) * perPage;

  const db = new Database(DB_PATH, { readonly: true });

  let where = '';
  let params: string[] = [];
  if (keyword) {
    where = 'WHERE ' + SEARCH_COLUMNS.map(col => `"${col}" LIKE ?`).join(' OR ');
    params = Array(SEARCH_COLUMNS.length).fill(`%${keyword}%`);
  }

  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM auction_list_cleaned ${where}`
  ).get(...params) as { cnt: number };
  const total = totalRow.cnt;

  const rows = db.prepare(
    `SELECT * FROM auction_list_cleaned ${where} LIMIT ? OFFSET ?`
  ).all(...params, perPage, offset);

  return NextResponse.json({
    data: rows,
    total,
  });
}