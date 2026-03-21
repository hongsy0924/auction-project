"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import styles from "./CompensationTab.module.css";
import {
    ChevronDown, ChevronUp, AlertTriangle, Building2,
    Loader, Search,
} from "lucide-react";
import Pagination from "./Pagination";
import { renderMarkdown } from "@/utils/renderMarkdown";

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

interface CompensationItem {
    doc_id: string;
    address: string;
    dong: string;
    pnu: string;
    score: number;
    signal_count: number;
    signal_keywords: string[];
    facility_count: number;
    has_unexecuted: number;
    has_compensation: number;
    notice_count: number;
    facility_details: FacilityDetail[];
    notice_details: NoticeDetail[];
    auction_data: Record<string, string | number | undefined>;
    has_analysis: boolean;
    score_breakdown?: Record<string, { raw: number; weighted: number }>;
    gosi_stage?: number;
}

const GOSI_STAGE_LABELS: Record<number, string> = {
    0: "-", 1: "결정", 2: "실시계획", 3: "사업인정", 4: "보상",
};
const GOSI_STAGE_COLORS: Record<number, string> = {
    0: "#9ca3af", 1: "#2563eb", 2: "#7c3aed", 3: "#ea580c", 4: "#dc2626",
};
const KEYWORD_COLORS: Record<string, string> = {
    "보상": "#dc2626", "수용": "#dc2626", "편입": "#ea580c",
    "도시계획": "#2563eb", "착공": "#059669", "개발": "#7c3aed",
    "도로": "#0891b2", "택지": "#ca8a04",
};

function getScoreColor(score: number): string {
    const pct = score <= 1 ? score * 100 : score;
    if (pct >= 80) return "#dc2626";
    if (pct >= 50) return "#ea580c";
    if (pct >= 30) return "#ca8a04";
    return "#059669";
}
function formatScore(score: number): string {
    if (score <= 1) return `${Math.round(score * 100)}%`;
    return String(score);
}
function formatPrice(n: number): string {
    if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n % 100_000_000 === 0 ? 0 : 1)}억`;
    if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
    return n.toLocaleString();
}

type SortKey = "score" | "facility_age" | "gosi_stage" | "facility" | "compensation";

export default function CompensationTab() {
    const [items, setItems] = useState<CompensationItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [sortBy, setSortBy] = useState<SortKey>("score");
    const [facilityType, setFacilityType] = useState<string | null>(null);
    const [filterIncludeOnly, setFilterIncludeOnly] = useState(false);
    const [filterUnexecutedOnly, setFilterUnexecutedOnly] = useState(false);
    const [facilityTypeCounts, setFacilityTypeCounts] = useState<{ type: string; count: number }[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [analysisCache, setAnalysisCache] = useState<Record<string, string>>({});
    const [analysisLoading, setAnalysisLoading] = useState<string | null>(null);

    const stats = useMemo(() => ({
        total,
        compensationCount: items.filter((i) => i.has_compensation === 1).length,
        unexecutedCount: items.filter((i) => i.has_unexecuted === 1).length,
    }), [items, total]);

    useEffect(() => { setPage(1); }, [sortBy, facilityType, filterIncludeOnly, filterUnexecutedOnly]);

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
            sort: sortBy,
            filter_facility: "1",
        });
        if (facilityType) params.set("facility_type", facilityType);
        if (filterIncludeOnly) params.set("filter_include_only", "1");
        if (filterUnexecutedOnly) params.set("filter_unexecuted_only", "1");

        fetch(`/api/signal-top?${params}`)
            .then((res) => res.json())
            .then((data) => {
                const mapped = (data.data || []).map((item: CompensationItem) => ({
                    ...item,
                    score_breakdown: item.auction_data?.score_breakdown,
                    gosi_stage: item.auction_data?.gosi_stage ?? 0,
                }));
                setItems(mapped);
                setTotal(data.total || 0);
                if (data.facilityTypeCounts) setFacilityTypeCounts(data.facilityTypeCounts);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [page, perPage, sortBy, facilityType, filterIncludeOnly, filterUnexecutedOnly]);

    const totalPages = Math.ceil(total / perPage);

    const handleExpand = useCallback(
        async (docId: string) => {
            if (expandedId === docId) { setExpandedId(null); return; }
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

    const totalFacilityCount = useMemo(
        () => facilityTypeCounts.reduce((sum, f) => sum + f.count, 0),
        [facilityTypeCounts]
    );

    if (loading && items.length === 0) {
        return (
            <div className={styles.emptyState}>
                <Loader size={32} className={styles.spinIcon} />
                <p className={styles.emptyTitle}>보상 후보 데이터 로딩 중...</p>
            </div>
        );
    }

    if (!loading && items.length === 0 && !facilityType) {
        return (
            <div className={styles.emptyState}>
                <Search size={40} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                <p className={styles.emptyTitle}>포함/저촉 물건이 없습니다</p>
                <p className={styles.emptySubtitle}>
                    크롤링 후 시그널 분석이 실행되면 도시계획시설 포함/저촉 물건이 여기에 표시됩니다.
                </p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Stats bar */}
            <div className={styles.statsBar}>
                <div className={styles.statItem}>
                    <span className={styles.statValue}>{stats.total}</span>
                    <span className={styles.statLabel}>포함/저촉 물건</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue} style={{ color: "#dc2626" }}>{stats.compensationCount}</span>
                    <span className={styles.statLabel}>보상 단계</span>
                </div>
                <div className={styles.statItem}>
                    <span className={styles.statValue} style={{ color: "#ea580c" }}>{stats.unexecutedCount}</span>
                    <span className={styles.statLabel}>미집행</span>
                </div>
            </div>

            {/* Facility type filter pills */}
            {facilityTypeCounts.length > 0 && (
                <div className={styles.facilityFilters}>
                    <button
                        className={`${styles.facilityPill} ${facilityType === null ? styles.facilityPillActive : ""}`}
                        onClick={() => setFacilityType(null)}
                    >
                        전체 {totalFacilityCount}
                    </button>
                    {facilityTypeCounts.map((ft) => (
                        <button
                            key={ft.type}
                            className={`${styles.facilityPill} ${facilityType === ft.type ? styles.facilityPillActive : ""}`}
                            onClick={() => setFacilityType(facilityType === ft.type ? null : ft.type)}
                        >
                            {ft.type} {ft.count}
                        </button>
                    ))}
                </div>
            )}

            {/* Sort/Filter controls */}
            <div className={styles.controls}>
                <div className={styles.sortGroup}>
                    {(["score", "facility_age", "gosi_stage", "facility", "compensation"] as SortKey[]).map((key) => (
                        <button
                            key={key}
                            className={`${styles.sortBtn} ${sortBy === key ? styles.sortBtnActive : ""}`}
                            onClick={() => setSortBy(key)}
                        >
                            {key === "score" ? "점수순" : key === "facility_age" ? "경과연수" : key === "gosi_stage" ? "사업단계" : key === "facility" ? "시설순" : "보상순"}
                        </button>
                    ))}
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                    <button
                        className={`${styles.filterBtn} ${filterIncludeOnly ? styles.filterBtnActive : ""}`}
                        onClick={() => setFilterIncludeOnly(!filterIncludeOnly)}
                    >
                        포함만
                    </button>
                    <button
                        className={`${styles.filterBtn} ${filterUnexecutedOnly ? styles.filterBtnActive : ""}`}
                        onClick={() => setFilterUnexecutedOnly(!filterUnexecutedOnly)}
                    >
                        미집행만
                    </button>
                </div>
            </div>

            {/* Card list */}
            <div className={styles.cardList}>
                {items.map((item, idx) => {
                    const rank = (page - 1) * perPage + idx + 1;
                    const isExpanded = expandedId === item.doc_id;
                    const analysis = analysisCache[item.doc_id];
                    const isLoadingAnalysis = analysisLoading === item.doc_id;
                    const auc = item.auction_data;
                    const pohaam = auc["포함"] ? String(auc["포함"]) : null;
                    const jeochok = auc["저촉"] ? String(auc["저촉"]) : null;

                    return (
                        <div key={item.doc_id} className={styles.card}>
                            <div className={styles.cardHeader} onClick={() => handleExpand(item.doc_id)} style={{ cursor: "pointer" }}>
                                <div className={styles.rankBadge}>#{rank}</div>
                                <div className={styles.scoreBadge} style={{ background: getScoreColor(item.score) }}>
                                    {formatScore(item.score)}
                                </div>
                                {(item.gosi_stage ?? 0) > 0 && (
                                    <div className={styles.gosiBadge} style={{
                                        background: `${GOSI_STAGE_COLORS[item.gosi_stage || 0]}15`,
                                        color: GOSI_STAGE_COLORS[item.gosi_stage || 0],
                                        borderColor: `${GOSI_STAGE_COLORS[item.gosi_stage || 0]}40`,
                                    }}>
                                        {GOSI_STAGE_LABELS[item.gosi_stage || 0]}
                                    </div>
                                )}
                                <div className={styles.cardInfo}>
                                    <div className={styles.cardAddress}><span>{item.address}</span></div>
                                    <div className={styles.cardMeta}>
                                        {auc["사건번호"] && <span>{String(auc["사건번호"])}</span>}
                                        {auc["물건종류"] && <span>{String(auc["물건종류"])}</span>}
                                        {auc["지목"] && <span>{String(auc["지목"])}</span>}
                                        {auc["면적"] && <span>{String(auc["면적"])}</span>}
                                        {auc["매각기일"] && <span>{String(auc["매각기일"])}</span>}
                                    </div>
                                    <div className={styles.cardMeta}>
                                        {auc["감정평가액"] && <span>{formatPrice(Number(auc["감정평가액"]))}</span>}
                                        {auc["최저매각가격"] && <span>→ {formatPrice(Number(auc["최저매각가격"]))}</span>}
                                        {auc["%"] && <span style={{ color: "#dc2626", fontWeight: 700 }}>{String(auc["%"])}</span>}
                                    </div>
                                </div>
                                <div className={styles.expandToggle}>
                                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </div>
                            </div>

                            <div className={styles.cardBody}>
                                {/* Facility highlight (hero section) */}
                                <div className={styles.facilityHighlight}>
                                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>도시계획시설</div>
                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                                        {pohaam && (
                                            <span className={styles.facilityTag} style={{ background: "#dc262618", color: "#f87171", borderColor: "#dc262630" }}>
                                                포함: {pohaam}
                                            </span>
                                        )}
                                        {jeochok && (
                                            <span className={styles.facilityTag} style={{ background: "#ea580c18", color: "#f97316", borderColor: "#ea580c30" }}>
                                                저촉: {jeochok}
                                            </span>
                                        )}
                                        {item.has_unexecuted === 1 && (
                                            <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>미집행</span>
                                        )}
                                        {auc["시설경과연수"] && Number(auc["시설경과연수"]) > 0 && (
                                            <span style={{ fontSize: "11px", color: "#a78bfa", fontWeight: 600 }}>
                                                경과 {Math.round(Number(auc["시설경과연수"]))}년
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Signal keyword pills */}
                                {item.signal_keywords.length > 0 && (
                                    <div className={styles.pills}>
                                        {item.signal_keywords.map((kw) => (
                                            <span key={kw} className={styles.pill} style={{
                                                background: `${KEYWORD_COLORS[kw] || "#6b7280"}18`,
                                                color: KEYWORD_COLORS[kw] || "#6b7280",
                                                borderColor: `${KEYWORD_COLORS[kw] || "#6b7280"}30`,
                                            }}>
                                                {kw}
                                            </span>
                                        ))}
                                        {item.notice_count > 0 && (
                                            <span className={styles.pill} style={{ background: "#b91c1c18", color: "#b91c1c", borderColor: "#b91c1c30", fontWeight: 600 }}>
                                                고시 {item.notice_count}건
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Score breakdown (4 factors) */}
                                {item.score_breakdown && (
                                    <div className={styles.breakdownGrid}>
                                        {([
                                            ["facility_coverage", "시설", "#2563eb"],
                                            ["facility_age", "연수", "#7c3aed"],
                                            ["gosi_stage", "단계", "#dc2626"],
                                            ["timing", "유찰", "#059669"],
                                        ] as [string, string, string][]).map(([key, label, color]) => {
                                            const comp = item.score_breakdown?.[key];
                                            if (!comp) return null;
                                            return (
                                                <div key={key} className={styles.breakdownColumn}>
                                                    <div className={styles.breakdownBarTrack}>
                                                        <div className={styles.breakdownBarFill} style={{
                                                            width: `${Math.max(comp.raw * 100, 2)}%`,
                                                            background: color,
                                                            opacity: comp.raw > 0 ? 1 : 0.15,
                                                        }} />
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
                                        <div className={styles.analysisContent} dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }} />
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
