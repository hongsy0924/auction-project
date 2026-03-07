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
import SignalTopTab from "./SignalTopTab";
import MinutesSearchPage from "../minutes/MinutesSearchPage";
import { LayoutGrid, TrendingUp, MessageSquare } from "lucide-react";

type TabId = "auction-list" | "signal-top" | "minutes";

export default function AuctionPageClient() {
    const [activeTab, setActiveTab] = useState<TabId>("auction-list");
    const [data, setData] = useState<AuctionItem[]>([]);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [appliedKeyword, setAppliedKeyword] = useState("");
    const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

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

    const handleRowClick = (row: AuctionItem) => {
        const docId = String(row["고유키"] || "");
        setExpandedDocId((prev) => (prev === docId ? null : docId));
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
            <header style={{ paddingBottom: "0", borderBottom: "none" }}>
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    marginBottom: "16px",
                }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <LayoutGrid size={20} style={{ color: "var(--primary)" }} />
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                Dashboard
                            </span>
                        </div>
                        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.5px" }}>
                            경매물건 목록
                            {activeTab === "auction-list" && (
                                <span style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-muted)", marginLeft: "12px" }}>
                                    총 {total.toLocaleString()}건
                                </span>
                            )}
                        </h1>
                    </div>
                </div>
                <nav style={{
                    display: "flex",
                    gap: "0",
                    borderBottom: "1px solid var(--border-color)",
                }}>
                    {([
                        { id: "auction-list" as TabId, label: "경매 목록", icon: <LayoutGrid size={15} /> },
                        { id: "signal-top" as TabId, label: "투자 시그널", icon: <TrendingUp size={15} /> },
                        { id: "minutes" as TabId, label: "회의록 검색", icon: <MessageSquare size={15} /> },
                    ]).map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "10px 20px",
                                fontSize: "14px",
                                fontWeight: activeTab === tab.id ? 700 : 500,
                                color: activeTab === tab.id ? "var(--primary)" : "var(--text-muted)",
                                background: "none",
                                border: "none",
                                borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
                                cursor: "pointer",
                                transition: "var(--transition-base)",
                                marginBottom: "-1px",
                            }}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </header>

            {activeTab === "auction-list" && (
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
                        expandedDocId={expandedDocId}
                        onRowClick={handleRowClick}
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
            )}
            {activeTab === "signal-top" && <SignalTopTab />}
            {activeTab === "minutes" && <MinutesSearchPage embedded />}
        </div>
    );
}
