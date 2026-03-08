"use client";

import React, { useEffect, useState, useCallback } from "react";
import styles from "./SignalTopTab.module.css";
import {
    FileText, ChevronDown, ChevronUp,
    AlertTriangle, Building2, Loader, Search,
} from "lucide-react";
import Pagination from "./Pagination";
import { renderMarkdown } from "@/utils/renderMarkdown";

interface SignalDetail {
    keyword: string;
    doc_count: number;
    signal_summary?: string;
}

interface FacilityDetail {
    facilityName: string;
    facilityType: string;
    executionStatus?: string;
}

interface SignalTopItem {
    doc_id: string;
    address: string;
    dong: string;
    pnu: string;
    sido: string;
    sigungu: string;
    score: number;
    signal_count: number;
    signal_keywords: string[];
    facility_count: number;
    has_unexecuted: number;
    has_compensation: number;
    signal_details: SignalDetail[];
    facility_details: FacilityDetail[];
    auction_data: Record<string, string | number | undefined>;
    has_analysis: boolean;
}

const KEYWORD_COLORS: Record<string, string> = {
    "보상": "#dc2626",
    "수용": "#dc2626",
    "편입": "#ea580c",
    "도시계획": "#2563eb",
    "착공": "#059669",
    "개발": "#7c3aed",
    "도로": "#0891b2",
    "택지": "#ca8a04",
};

function getScoreColor(score: number): string {
    if (score >= 80) return "#dc2626";
    if (score >= 50) return "#ea580c";
    if (score >= 30) return "#ca8a04";
    return "#059669";
}

function formatPrice(n: number): string {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n % 100_000_000 === 0 ? 0 : 1)}억`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
    return n.toLocaleString();
}

export default function SignalTopTab() {
    const [items, setItems] = useState<SignalTopItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [analysisCache, setAnalysisCache] = useState<Record<string, string>>({});
    const [analysisLoading, setAnalysisLoading] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        fetch(`/api/signal-top?page=${page}&per_page=${perPage}`)
            .then((res) => res.json())
            .then((data) => {
                setItems(data.data || []);
                setTotal(data.total || 0);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [page, perPage]);

    const totalPages = Math.ceil(total / perPage);

    const handleExpand = useCallback(
        async (docId: string) => {
            if (expandedId === docId) {
                setExpandedId(null);
                return;
            }
            setExpandedId(docId);

            if (!analysisCache[docId]) {
                setAnalysisLoading(docId);
                try {
                    const res = await fetch(`/api/signal-top/analysis?doc_id=${encodeURIComponent(docId)}`);
                    if (res.ok) {
                        const data = await res.json();
                        setAnalysisCache((prev) => ({ ...prev, [docId]: data.analysis_markdown }));
                    }
                } catch { /* ignore */ }
                setAnalysisLoading(null);
            }
        },
        [expandedId, analysisCache]
    );

    if (loading) {
        return (
            <div className={styles.emptyState}>
                <Loader size={32} className={styles.spinIcon} />
                <p className={styles.emptyTitle}>시그널 데이터 로딩 중...</p>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className={styles.emptyState}>
                <Search size={40} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                <p className={styles.emptyTitle}>사전 분석된 시그널이 아직 없습니다</p>
                <p className={styles.emptySubtitle}>
                    크롤링 후 자동 시그널 분석이 실행되면 여기에 결과가 표시됩니다.
                </p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>
                {total}건
            </div>

            <div className={styles.cardList}>
                {items.map((item, idx) => {
                    const rank = (page - 1) * perPage + idx + 1;
                    const isExpanded = expandedId === item.doc_id;
                    const analysis = analysisCache[item.doc_id];
                    const isLoadingAnalysis = analysisLoading === item.doc_id;
                    const auc = item.auction_data;

                    return (
                        <div key={item.doc_id} className={styles.card}>
                            <div
                                className={styles.cardHeader}
                                onClick={() => item.has_analysis ? handleExpand(item.doc_id) : undefined}
                                style={{ cursor: item.has_analysis ? "pointer" : "default" }}
                            >
                                <div className={styles.rankBadge}>#{rank}</div>
                                <div
                                    className={styles.scoreBadge}
                                    style={{ background: getScoreColor(item.score) }}
                                >
                                    {item.score}
                                </div>

                                <div className={styles.cardInfo}>
                                    <div className={styles.cardAddress}>
                                        <span>{item.address}</span>
                                    </div>
                                    <div className={styles.cardMeta}>
                                        {auc["사건번호"] && <span>{String(auc["사건번호"])}</span>}
                                        {auc["물건종류"] && <span>{String(auc["물건종류"])}</span>}
                                        {auc["면적"] && <span>{String(auc["면적"])}</span>}
                                    </div>
                                    {(auc["감정평가액"] || auc["최저매각가격"]) && (
                                        <div className={styles.cardPrice}>
                                            {auc["감정평가액"] && (
                                                <span>{formatPrice(Number(auc["감정평가액"]))}</span>
                                            )}
                                            {auc["최저매각가격"] && (
                                                <span className={styles.priceArrow}>
                                                    → {formatPrice(Number(auc["최저매각가격"]))}
                                                </span>
                                            )}
                                            {auc["%"] && (
                                                <span className={styles.pricePercent}>{String(auc["%"])}</span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {item.has_analysis && (
                                    <div className={styles.expandToggle}>
                                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                    </div>
                                )}
                            </div>

                            <div className={styles.cardBody}>
                                {/* Signal keywords */}
                                <div className={styles.pills}>
                                    {item.signal_keywords.map((kw) => (
                                        <span
                                            key={kw}
                                            className={styles.pill}
                                            style={{
                                                background: `${KEYWORD_COLORS[kw] || "#6b7280"}18`,
                                                color: KEYWORD_COLORS[kw] || "#6b7280",
                                                borderColor: `${KEYWORD_COLORS[kw] || "#6b7280"}30`,
                                            }}
                                        >
                                            {kw}
                                        </span>
                                    ))}
                                </div>

                                {/* Signal summary */}
                                <div className={styles.signalSummary}>
                                    <FileText size={13} />
                                    <span>회의록 {item.signal_count}건 발견</span>
                                    {item.facility_count > 0 && (
                                        <>
                                            <Building2 size={13} />
                                            <span>도시계획시설 {item.facility_count}건</span>
                                        </>
                                    )}
                                    {item.has_unexecuted === 1 && (
                                        <span className={styles.unexecutedBadge}>미집행</span>
                                    )}
                                    {item.has_compensation === 1 && (
                                        <span className={styles.compensationBadge}>
                                            <AlertTriangle size={11} />
                                            보상 시그널
                                        </span>
                                    )}
                                </div>

                                {/* Facility details */}
                                {item.facility_details.length > 0 && (
                                    <div className={styles.facilityList}>
                                        {item.facility_details.map((f, i) => (
                                            <span key={i} className={styles.facilityItem}>
                                                {f.facilityType}: {f.facilityName}
                                                {f.executionStatus && (
                                                    <span className={
                                                        f.executionStatus === "집행완료"
                                                            ? styles.execDone
                                                            : styles.execPending
                                                    }>
                                                        ({f.executionStatus})
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Expanded analysis */}
                            {isExpanded && (
                                <div className={styles.analysisSection}>
                                    {isLoadingAnalysis ? (
                                        <div className={styles.analysisLoading}>
                                            <Loader size={16} className={styles.spinIcon} />
                                            <span>분석 결과 로딩 중...</span>
                                        </div>
                                    ) : analysis ? (
                                        <div className={styles.analysisWrapper}>
                                            <div className={styles.analysisHeader}>
                                                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)" }}>분석 결과</span>
                                            </div>
                                            <div
                                                className={styles.analysisContent}
                                                dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }}
                                            />
                                        </div>
                                    ) : (
                                        <div className={styles.analysisLoading}>
                                            <span>분석 결과를 불러올 수 없습니다.</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {totalPages > 1 && (
                <div style={{ padding: "24px 0" }}>
                    <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
            )}
        </div>
    );
}
