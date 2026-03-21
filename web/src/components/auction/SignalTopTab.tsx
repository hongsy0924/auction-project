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

interface NoticeDetail {
    title: string;
    noticeType: string;
    noticeDate: string;
    link?: string;
    gosiStage?: number;
    matchType?: string;
}

interface PermitDetail {
    projectName: string;
    permitType: string;
    permitDate: string;
    area?: string;
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
    notice_count: number;
    permit_count: number;
    has_pnu_match: number;
    signal_details: SignalDetail[];
    facility_details: FacilityDetail[];
    notice_details: NoticeDetail[];
    permit_details: PermitDetail[];
    auction_data: Record<string, string | number | undefined>;
    has_analysis: boolean;
    score_breakdown?: Record<string, { raw: number; weighted: number }>;
    gosi_stage?: number;
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
    const pct = score <= 1 ? score * 100 : score; // handle both 0-1 and legacy 0-200
    if (pct >= 80) return "#dc2626";
    if (pct >= 50) return "#ea580c";
    if (pct >= 30) return "#ca8a04";
    return "#059669";
}

function formatScore(score: number): string {
    if (score <= 1) return `${Math.round(score * 100)}%`;
    return String(score); // legacy format
}

const GOSI_STAGE_LABELS: Record<number, string> = {
    0: "-",
    1: "결정",
    2: "실시계획",
    3: "사업인정",
    4: "보상",
};

const GOSI_STAGE_COLORS: Record<number, string> = {
    0: "#9ca3af",
    1: "#2563eb",
    2: "#7c3aed",
    3: "#ea580c",
    4: "#dc2626",
};

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

    type SortKey = "score" | "facility" | "compensation" | "price_ratio" | "facility_age" | "gosi_stage";
    const [sortBy, setSortBy] = useState<SortKey>("score");
    const [filterCompensation, setFilterCompensation] = useState(false);
    const [excludeHousing, setExcludeHousing] = useState(true);

    // Items are already sorted/filtered server-side
    const sortedItems = items;

    const stats = React.useMemo(() => ({
        total,
        compensationCount: items.filter((i) => i.has_compensation === 1).length,
        unexecutedCount: items.filter((i) => i.has_unexecuted === 1).length,
        avgScore: items.length > 0 ? items.reduce((s, i) => s + i.score, 0) / items.length : 0,
    }), [items, total]);

    // Reset page when sort/filter changes
    useEffect(() => {
        setPage(1);
    }, [sortBy, filterCompensation, excludeHousing]);

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
            sort: sortBy,
        });
        if (filterCompensation) params.set("filter_compensation", "1");
        if (excludeHousing) params.set("exclude_housing", "1");

        fetch(`/api/signal-top?${params}`)
            .then((res) => res.json())
            .then((data) => {
                const mappedItems = (data.data || []).map((item: SignalTopItem) => ({
                    ...item,
                    score_breakdown: item.auction_data?.score_breakdown,
                    gosi_stage: item.auction_data?.gosi_stage ?? 0,
                }));
                setItems(mappedItems);
                setTotal(data.total || 0);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [page, perPage, sortBy, filterCompensation, excludeHousing]);

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
            {/* Summary stats bar */}
            <div className={styles.statsBar}>
                <div className={styles.statItem}>
                    <span className={styles.statValue}>{stats.total}</span>
                    <span className={styles.statLabel}>전체</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue} style={{ color: "#dc2626" }}>{stats.compensationCount}</span>
                    <span className={styles.statLabel}>보상 시그널</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue} style={{ color: "#ea580c" }}>{stats.unexecutedCount}</span>
                    <span className={styles.statLabel}>미집행 시설</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue}>{formatScore(stats.avgScore)}</span>
                    <span className={styles.statLabel}>평균 점수</span>
                </div>
            </div>

            {/* Sort/Filter controls */}
            <div className={styles.controls}>
                <div className={styles.sortGroup}>
                    {(["score", "price_ratio", "facility_age", "gosi_stage", "facility", "compensation"] as SortKey[]).map((key) => (
                        <button
                            key={key}
                            className={`${styles.sortBtn} ${sortBy === key ? styles.sortBtnActive : ""}`}
                            onClick={() => setSortBy(key)}
                        >
                            {key === "score" ? "점수순" : key === "facility" ? "시설순" : key === "compensation" ? "보상순" : key === "price_ratio" ? "공시지가비율" : key === "facility_age" ? "경과연수" : "사업단계"}
                        </button>
                    ))}
                </div>
                <button
                    className={`${styles.filterBtn} ${excludeHousing ? styles.filterBtnActive : ""}`}
                    onClick={() => setExcludeHousing(!excludeHousing)}
                >
                    <Building2 size={13} />
                    주택 제외
                </button>
                <button
                    className={`${styles.filterBtn} ${filterCompensation ? styles.filterBtnActive : ""}`}
                    onClick={() => setFilterCompensation(!filterCompensation)}
                >
                    <AlertTriangle size={13} />
                    보상대상만
                </button>
            </div>

            <div className={styles.cardList}>
                {sortedItems.map((item, idx) => {
                    const rank = (page - 1) * perPage + idx + 1;
                    const isExpanded = expandedId === item.doc_id;
                    const analysis = analysisCache[item.doc_id];
                    const isLoadingAnalysis = analysisLoading === item.doc_id;
                    const auc = item.auction_data;

                    return (
                        <div key={item.doc_id} className={styles.card}>
                            <div
                                className={styles.cardHeader}
                                onClick={() => handleExpand(item.doc_id)}
                                style={{ cursor: "pointer" }}
                            >
                                <div className={styles.rankBadge}>#{rank}</div>
                                <div
                                    className={styles.scoreBadge}
                                    style={{ background: getScoreColor(item.score) }}
                                >
                                    {formatScore(item.score)}
                                </div>
                                {(item.gosi_stage ?? 0) > 0 && (
                                    <div
                                        className={styles.gosiBadge}
                                        style={{
                                            background: `${GOSI_STAGE_COLORS[item.gosi_stage || 0]}15`,
                                            color: GOSI_STAGE_COLORS[item.gosi_stage || 0],
                                            borderColor: `${GOSI_STAGE_COLORS[item.gosi_stage || 0]}40`,
                                        }}
                                    >
                                        {GOSI_STAGE_LABELS[item.gosi_stage || 0]}
                                    </div>
                                )}

                                <div className={styles.cardInfo}>
                                    <div className={styles.cardAddress}>
                                        <span>{item.address}</span>
                                    </div>
                                    <div className={styles.cardMeta}>
                                        {auc["사건번호"] && <span>{String(auc["사건번호"])}</span>}
                                        {auc["물건종류"] && <span>{String(auc["물건종류"])}</span>}
                                        {auc["지목"] && <span>{String(auc["지목"])}</span>}
                                        {auc["면적"] && <span>{String(auc["면적"])}</span>}
                                        {auc["매각기일"] && <span>{String(auc["매각기일"])}</span>}
                                    </div>
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
                                        {auc["최저가/공시지가비율"] && (
                                            <span
                                                className={styles.priceRatioBadge}
                                                style={{
                                                    color: Number(auc["최저가/공시지가비율"]) <= 0.5 ? "#059669" :
                                                        Number(auc["최저가/공시지가비율"]) <= 0.7 ? "#ca8a04" :
                                                        Number(auc["최저가/공시지가비율"]) <= 0.9 ? "#ea580c" : "#dc2626",
                                                }}
                                            >
                                                공시지가 {(Number(auc["최저가/공시지가비율"]) * 100).toFixed(0)}%
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className={styles.expandToggle}>
                                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </div>
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

                                {/* EUM badges (notices/permits) */}
                                {(item.notice_count > 0 || item.permit_count > 0) && (
                                    <div className={styles.pills}>
                                        {item.notice_count > 0 && (
                                            <span
                                                className={styles.pill}
                                                style={{
                                                    background: "#b91c1c18",
                                                    color: "#b91c1c",
                                                    borderColor: "#b91c1c30",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                고시 {item.notice_count}건
                                            </span>
                                        )}
                                        {item.permit_count > 0 && (
                                            <span
                                                className={styles.pill}
                                                style={{
                                                    background: "#7c3aed18",
                                                    color: "#7c3aed",
                                                    borderColor: "#7c3aed30",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                인허가 {item.permit_count}건
                                            </span>
                                        )}
                                        {item.has_pnu_match === 1 && (
                                            <span
                                                className={styles.pill}
                                                style={{
                                                    background: "#dc262618",
                                                    color: "#dc2626",
                                                    borderColor: "#dc262630",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                필지 매칭
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Signal summary */}
                                <div className={styles.signalSummary}>
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

                                {/* Score breakdown */}
                                <div className={styles.scoreBreakdown}>
                                    {item.facility_count > 0 && (
                                        <span className={styles.breakdownItem}>
                                            시설 {item.facility_count}
                                            {item.has_unexecuted === 1 && <span className={styles.unexecutedDot} />}
                                        </span>
                                    )}
                                    {item.notice_count > 0 && <span className={styles.breakdownItem}>고시 {item.notice_count}</span>}
                                    {item.permit_count > 0 && <span className={styles.breakdownItem}>인허가 {item.permit_count}</span>}
                                </div>

                                {/* Score breakdown */}
                                {item.score_breakdown && (
                                    <div className={styles.breakdownGrid}>
                                        {([
                                            ["facility_coverage", "시설저촉", "#2563eb"],
                                            ["facility_age", "경과연수", "#7c3aed"],
                                            ["gosi_stage", "사업단계", "#dc2626"],
                                            ["price_attractiveness", "가격매력", "#ea580c"],
                                            ["timing", "유찰", "#059669"],
                                        ] as [string, string, string][]).map(([key, label, color]) => {
                                            const comp = item.score_breakdown?.[key];
                                            if (!comp) return null;
                                            return (
                                                <div key={key} className={styles.breakdownColumn}>
                                                    <div className={styles.breakdownBarTrack}>
                                                        <div
                                                            className={styles.breakdownBarFill}
                                                            style={{
                                                                width: `${Math.max(comp.raw * 100, 2)}%`,
                                                                background: color,
                                                                opacity: comp.raw > 0 ? 1 : 0.15,
                                                            }}
                                                        />
                                                    </div>
                                                    <span className={styles.breakdownLabel} style={{ color: comp.raw > 0 ? color : undefined }}>
                                                        {label}
                                                        {comp.raw > 0 && <span className={styles.breakdownValue}>{(comp.raw * 100).toFixed(0)}</span>}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Notice details (dong-matched gosi) */}
                                {item.notice_details && item.notice_details.length > 0 && (
                                    <div className={styles.facilityList}>
                                        {item.notice_details.slice(0, 5).map((n, i) => (
                                            <span key={i} className={styles.facilityItem}>
                                                <span style={{
                                                    color: GOSI_STAGE_COLORS[n.gosiStage || 0] || "#b91c1c",
                                                    fontWeight: 600,
                                                    fontSize: "11px",
                                                }}>
                                                    {GOSI_STAGE_LABELS[n.gosiStage || 0] || "고시"}
                                                </span>{" "}
                                                {n.link ? (
                                                    <a
                                                        href={n.link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: "inherit", textDecoration: "underline" }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {n.title.length > 70 ? n.title.slice(0, 70) + "..." : n.title}
                                                    </a>
                                                ) : (
                                                    <span>{n.title.length > 70 ? n.title.slice(0, 70) + "..." : n.title}</span>
                                                )}
                                                {n.noticeDate && (
                                                    <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: "4px" }}>
                                                        ({n.noticeDate})
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                        {item.notice_details.length > 5 && (
                                            <span className={styles.facilityItem} style={{ color: "var(--text-muted)" }}>
                                                ... 외 {item.notice_details.length - 5}건
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Permit details */}
                                {item.permit_details && item.permit_details.length > 0 && (
                                    <div className={styles.facilityList}>
                                        {item.permit_details.slice(0, 5).map((p, i) => (
                                            <span key={i} className={styles.facilityItem}>
                                                <span style={{ color: "#7c3aed", fontWeight: 500 }}>인허가</span>{" "}
                                                {p.projectName.length > 50 ? p.projectName.slice(0, 50) + "..." : p.projectName}
                                                {p.permitDate && (
                                                    <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: "4px" }}>
                                                        ({p.permitDate})
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                        {item.permit_details.length > 5 && (
                                            <span className={styles.facilityItem} style={{ color: "var(--text-muted)" }}>
                                                ... 외 {item.permit_details.length - 5}건
                                            </span>
                                        )}
                                    </div>
                                )}

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
