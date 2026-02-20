"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
    AuctionItem,
    AuctionListResponse,
    VISIBLE_COLUMNS,
    FROZEN_COLUMNS,
    COLUMN_WIDTHS,
} from "@/types/auction";
import AuctionSearch from "./AuctionSearch";
import AuctionTable from "./AuctionTable";
import Pagination from "./Pagination";
import { LayoutGrid, Search } from "lucide-react";

export default function AuctionPageClient() {
    const [data, setData] = useState<AuctionItem[]>([]);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [appliedKeyword, setAppliedKeyword] = useState("");

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({
            page: page.toString(),
            per_page: perPage.toString(),
            ...(appliedKeyword ? { keyword: appliedKeyword } : {}),
        });
        fetch(`/api/auction-list?${params}`)
            .then((res) => res.json())
            .then((res: AuctionListResponse) => {
                setData(Array.isArray(res.data) ? res.data : []);
                setTotal(res.total);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [page, perPage, appliedKeyword]);

    // 데이터에서 실제 존재하는 컬럼만 필터링
    const columns = useMemo(() => {
        const allAvailable = data.length > 0 ? Object.keys(data[0]) : VISIBLE_COLUMNS;
        return [...VISIBLE_COLUMNS].filter((col) => allAvailable.includes(col));
    }, [data]);

    // stickyColumns의 left 값을 누적합으로 계산
    const stickyColumns = useMemo(() => {
        const result: Record<string, number> = {};
        let left = 0;
        for (const col of FROZEN_COLUMNS) {
            if (columns.includes(col)) {
                result[col] = left;
                left += COLUMN_WIDTHS[col] || 100;
            }
        }
        return result;
    }, [columns]);

    const totalPages = Math.ceil(total / perPage);

    const handleSearch = (keyword: string) => {
        setPage(1);
        setAppliedKeyword(keyword);
    };

    const handleReset = () => {
        setPage(1);
        setAppliedKeyword("");
    };

    return (
        <div style={{
            padding: "32px 24px",
            maxWidth: "1440px",
            margin: "0 auto",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            gap: "24px"
        }}>
            <header style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                paddingBottom: "16px",
                borderBottom: "1px solid var(--border-color)"
            }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <LayoutGrid size={20} className="text-primary" style={{ color: "var(--primary)" }} />
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Dashboard
                        </span>
                    </div>
                    <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.5px" }}>
                        경매물건 목록
                        <span style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-muted)", marginLeft: "12px" }}>
                            총 {total.toLocaleString()}건
                        </span>
                    </h1>
                </div>

                <a
                    href="/minutes"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 18px",
                        fontSize: "14px",
                        color: "var(--primary)",
                        background: "var(--primary-soft)",
                        borderRadius: "var(--radius-md)",
                        textDecoration: "none",
                        fontWeight: 600,
                        transition: "var(--transition-base)"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(0.95)"}
                    onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
                >
                    <Search size={16} />
                    회의록 검색
                </a>
            </header>

            <main style={{
                background: "var(--bg-secondary)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-md)",
                overflow: "hidden",
                border: "1px solid var(--border-color)",
                display: "flex",
                flexDirection: "column"
            }}>
                <div style={{ padding: "20px 24px" }}>
                    <AuctionSearch
                        onSearch={handleSearch}
                        onReset={handleReset}
                        hasActiveSearch={!!appliedKeyword}
                    />
                </div>

                <AuctionTable
                    data={data}
                    columns={columns}
                    stickyColumns={stickyColumns}
                    keyword={appliedKeyword}
                    onReset={handleReset}
                    loading={loading}
                />

                {!loading && (
                    <div style={{ padding: "24px" }}>
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </main>
        </div>
    );
}
