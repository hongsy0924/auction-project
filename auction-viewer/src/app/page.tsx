"use client";
import React, { useEffect, useState } from "react";
import styles from "./page.module.css";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedLayout from "@/components/auth/ProtectedLayout";

type AuctionItem = { [key: string]: string | number };

function AuctionList() {
  const [data, setData] = useState<AuctionItem[]>([]);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const numberColumns = ["감정평가액", "최저매각가격"];

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      per_page: perPage.toString(),
      ...(appliedKeyword ? { keyword: appliedKeyword } : {})
    });
    fetch(`/api/auction-list?${params}`)
      .then((res) => res.json())
      .then((res) => {
        setData(Array.isArray(res.data) ? res.data : []);
        setTotal(res.total);
        setLoading(false);
      });
  }, [page, perPage, appliedKeyword]);

  if (loading) return <div>Loading...</div>;

  // 표시할 컬럼 목록 (순서대로 표시됨)
  const visibleColumns = [
    "사건번호",
    "물건종류",
    "지목",
    "주소",
    "감정평가액",
    "최저매각가격",
    "%",
    "매각기일",
    "면적",
    "포함",
    "저촉",
    "접합",
  ];

  // 데이터에서 실제 존재하는 컬럼만 필터링
  const allAvailableColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const columns = visibleColumns.filter(col => allAvailableColumns.includes(col));

  const totalPages = Math.ceil(total / perPage);
  const maxPageButtons = 20;
  const currentBlock = Math.floor((page - 1) / maxPageButtons);
  const startPage = currentBlock * maxPageButtons + 1;
  const endPage = Math.min(startPage + maxPageButtons - 1, totalPages);

  // 프리징할 컬럼명(순서 중요) - 실제 표시되는 컬럼만 포함
  const frozenColumnNames = ["사건번호", "물건종류", "지목", "주소", "감정평가액", "최저매각가격", "%"];

  // 각 컬럼별 고정 너비
  const columnWidths: { [key: string]: number } = {
    사건번호: 100,
    물건종류: 50,
    지목: 50,
    주소: 100,
    지번: 50,
    감정평가액: 100,
    최저매각가격: 100,
    "%": 30,
  };

  // stickyColumns의 left 값을 누적합으로 계산 (실제 표시되는 컬럼만)
  const stickyColumns: { [key: string]: number } = {};
  let left = 0;
  for (const col of frozenColumnNames) {
    // 실제 표시되는 컬럼에만 sticky 적용
    if (columns.includes(col)) {
      stickyColumns[col] = left;
      left += columnWidths[col] || 100; // 기본값 100
    }
  }

  function highlightKeyword(text: string, keyword: string) {
    if (!keyword) return text;
    const parts = text.split(new RegExp(`(${keyword})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase() ? (
        <mark key={i} style={{ background: "#ffe066", color: "#222", padding: 0 }}>
          {part}
        </mark>
      ) : (
        part
      )
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>목록 (총 {total}건) 
        </h1>
        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="전체 검색"
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
            style={{ width: 200, fontSize: 14, marginRight: 8 }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                setPage(1);
                setAppliedKeyword(searchKeyword);
              }
            }}
          />
          <button
            onClick={() => {
              setPage(1);
              setAppliedKeyword(searchKeyword);
            }}
          >
            검색
          </button>
          {appliedKeyword && (
            <button
              onClick={() => {
                setPage(1);
                setSearchKeyword("");
                setAppliedKeyword("");
              }}
              style={{ marginLeft: 8 }}
            >
              검색 초기화
            </button>
          )}
        </div>
        {!data.length ? (
          <div style={{ padding: "40px", textAlign: "center", fontSize: 16 }}>
            검색 결과가 없습니다.
            {appliedKeyword && (
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => {
                    setPage(1);
                    setSearchKeyword("");
                    setAppliedKeyword("");
                  }}
                  style={{ padding: "8px 16px", fontSize: 14 }}
                >
                  검색 초기화
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ overflow: "auto", maxHeight: "70vh", maxWidth: "100vw" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 1200, fontSize: 12 }}>
            <thead>
              <tr>
                {columns.map((col) => {
                  const isFrozen = col in stickyColumns;
                  return (
                    <th
                      key={col}
                      style={{
                        position: isFrozen ? "sticky" : undefined,
                        left: isFrozen ? stickyColumns[col] : undefined,
                        background: isFrozen ? "#e0eaff" : "#eee",
                        zIndex: isFrozen ? 2 : 1,
                        padding: "8px 12px",
                        minWidth: columnWidths[col] || "auto",
                        width: columnWidths[col] || "auto",
                        boxShadow: isFrozen ? "2px 0 2px -1px #ccc" : undefined,
                      }}
                    >
                      {col}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  {columns.map((col, j) => {
                    let value = row[col];
                    // null 또는 undefined를 "-"로 변환
                    if (value == null || value === "") {
                      value = "-";
                    } else {
                      if (numberColumns.includes(col) && !isNaN(Number(value))) {
                        value = Number(value).toLocaleString();
                      }
                      if (col === "%") {
                        value = `${value}%`;
                      }
                    }
                    return (
                      <td key={j} style={{ position: "sticky", padding: "8px 12px" }}>
                        {highlightKeyword(String(value), appliedKeyword)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
            {page > 1 && (
              <button onClick={() => setPage(page - 1)} style={{ marginRight: 8 }}>
                이전
              </button>
            )}
            {Array.from({ length: endPage - startPage + 1 }, (_, i) => {
              const pageNum = startPage + i;
              const isCurrent = pageNum === page;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  style={{
                    margin: "0 2px",
                    padding: "4px 10px",
                    fontWeight: isCurrent ? "bold" : "normal",
                    textDecoration: isCurrent ? "underline" : "none",
                    color: isCurrent ? "#fff" : "#333",
                    background: isCurrent ? "#0070f3" : "#f0f0f0",
                    border: isCurrent ? "2px solid #0070f3" : "1px solid #ccc",
                    borderRadius: 4,
                    cursor: isCurrent ? "default" : "pointer"
                  }}
                  disabled={isCurrent}
                >
                  {pageNum}
                </button>
              );
            })}
            {endPage < totalPages && (
              <span style={{ margin: "0 4px" }}>...</span>
            )}
            {page < totalPages && (
              <button onClick={() => setPage(page + 1)} style={{ marginLeft: 8 }}>
                다음
              </button>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <ProtectedLayout>
        <AuctionList />
      </ProtectedLayout>
    </AuthProvider>
  );
}