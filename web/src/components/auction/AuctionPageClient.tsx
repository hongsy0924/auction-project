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
import dynamic from "next/dynamic";

const SignalTopTab = dynamic(() => import("./SignalTopTab"), { ssr: false });
const MinutesSearchPage = dynamic(() => import("../minutes/MinutesSearchPage"), { ssr: false });
const CompensationTab = dynamic(() => import("./CompensationTab"), { ssr: false });

type TabId = "auction-list" | "signal-top" | "compensation" | "minutes";

export default function AuctionPageClient() {
    const [activeTab, setActiveTab] = useState<TabId>("auction-list");
    const [data, setData] = useState<AuctionItem[]>([]);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [appliedKeyword, setAppliedKeyword] = useState("");
    const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
    const [hotZoneAlerts, setHotZoneAlerts] = useState<{ zone_title: string; matched_doc_ids: string; zone_stage: number }[]>([]);

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

    useEffect(() => {
        if (activeTab === "signal-top" || activeTab === "compensation") {
            fetch("/api/signal-top?page=1&per_page=1")
                .then((res) => res.json())
                .then((data) => {
                    if (data.hotZoneAlerts?.length > 0) {
                        setHotZoneAlerts(data.hotZoneAlerts);
                    }
                })
                .catch(() => {});
        }
    }, [activeTab]);

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
            padding: "16px 24px",
            maxWidth: "1440px",
            margin: "0 auto",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            gap: "24px"
        }}>
            <header style={{ borderBottom: "1px solid var(--border-color)" }}>
                <nav style={{ display: "flex", gap: "0", alignItems: "stretch" }}>
                    {([
                        { id: "auction-list" as TabId, label: "경매 목록", count: activeTab === "auction-list" ? total : undefined },
                        { id: "signal-top" as TabId, label: "투자 시그널" },
                        { id: "compensation" as TabId, label: "보상 후보" },
                        { id: "minutes" as TabId, label: "회의록 검색" },
                    ]).map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "12px 20px",
                                fontSize: "14px",
                                fontWeight: activeTab === tab.id ? 700 : 500,
                                color: activeTab === tab.id ? "var(--text-main)" : "var(--text-muted)",
                                background: "none",
                                border: "none",
                                borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
                                cursor: "pointer",
                                transition: "var(--transition-fast)",
                                marginBottom: "-1px",
                            }}
                        >
                            {tab.label}
                            {tab.count !== undefined && (
                                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>
                                    {tab.count.toLocaleString()}
                                </span>
                            )}
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
            {(activeTab === "signal-top" || activeTab === "compensation") && hotZoneAlerts.length > 0 && (
                <div style={{
                    padding: "14px 20px",
                    background: "#dc262610",
                    border: "1px solid #dc262630",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#dc2626", fontWeight: 700 }}>
                        <span style={{ fontSize: "16px" }}>!</span>
                        <span>
                            보상 확정 지역에 경매 물건 {hotZoneAlerts.reduce((sum, a) => sum + (JSON.parse(a.matched_doc_ids || "[]")).length, 0)}건 발견
                        </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "24px" }}>
                        {hotZoneAlerts.slice(0, 5).map((alert, i) => (
                            <span key={i} style={{
                                fontSize: "12px",
                                padding: "2px 10px",
                                borderRadius: "12px",
                                background: alert.zone_stage >= 4 ? "#dc262620" : "#ea580c20",
                                color: alert.zone_stage >= 4 ? "#dc2626" : "#ea580c",
                                fontWeight: 600,
                            }}>
                                {alert.zone_title.length > 40 ? alert.zone_title.slice(0, 40) + "..." : alert.zone_title}
                            </span>
                        ))}
                        {hotZoneAlerts.length > 5 && (
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                외 {hotZoneAlerts.length - 5}건
                            </span>
                        )}
                    </div>
                </div>
            )}
            {activeTab === "signal-top" && <SignalTopTab />}
            {activeTab === "compensation" && <CompensationTab />}
            {activeTab === "minutes" && <MinutesSearchPage embedded />}
        </div>
    );
}
