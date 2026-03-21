"use client";

import React, { useEffect, useState, useCallback } from "react";
import styles from "./SignalTopTab.module.css";
import {
    FileText, ChevronDown, ChevronUp,
    AlertTriangle, Building2, Loader, Search,
    HelpCircle, X,
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
    const [showHelp, setShowHelp] = useState(false);

    type SortKey = "score" | "facility" | "compensation" | "facility_age" | "gosi_stage";
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

            {/* Help modal */}
            {showHelp && (
                <div className={styles.helpOverlay} onClick={() => setShowHelp(false)}>
                    <div className={styles.helpModal} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.helpHeader}>
                            <span>시그널 용어 안내</span>
                            <button className={styles.helpClose} onClick={() => setShowHelp(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className={styles.helpBody}>
                            <div className={styles.helpSection}>
                                <h4>키워드 태그</h4>
                                <p className={styles.helpSectionDesc}>지방의회 회의록에서 해당 지역과 관련된 키워드가 언급된 횟수를 기반으로 표시됩니다.</p>
                                <dl className={styles.helpList}>
                                    <dt><span className={styles.helpPill} style={{ background: "#dc262618", color: "#dc2626", borderColor: "#dc262630" }}>보상</span></dt>
                                    <dd>토지 수용에 따른 보상 관련 논의가 회의록에 등장. 보상 절차가 진행 중이거나 예정된 지역일 가능성이 높습니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#dc262618", color: "#dc2626", borderColor: "#dc262630" }}>수용</span></dt>
                                    <dd>공익사업을 위한 토지 수용 관련 논의. 보상과 함께 나타나는 경우가 많으며, 사업 추진이 구체화된 단계를 시사합니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#ea580c18", color: "#ea580c", borderColor: "#ea580c30" }}>편입</span></dt>
                                    <dd>도로·공원 등 도시계획시설에 토지가 편입 예정이거나 편입된 상태. 향후 보상 가능성이 있는 핵심 시그널입니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#2563eb18", color: "#2563eb", borderColor: "#2563eb30" }}>도시계획</span></dt>
                                    <dd>도시계획 변경·결정 관련 논의. 용도지역 변경, 지구단위계획 등 토지 가치에 영향을 주는 계획이 논의되고 있음을 의미합니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#05966918", color: "#059669", borderColor: "#05966930" }}>착공</span></dt>
                                    <dd>도시계획시설 공사 착공 관련 논의. 실제 사업이 시작되는 단계로, 보상이 임박했거나 진행 중일 수 있습니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#7c3aed18", color: "#7c3aed", borderColor: "#7c3aed30" }}>개발</span></dt>
                                    <dd>지역 개발사업(택지개발, 재개발 등) 관련 논의. 광범위한 토지 가치 변동 가능성을 시사합니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#0891b218", color: "#0891b2", borderColor: "#0891b230" }}>도로</span></dt>
                                    <dd>도로 개설·확장 관련 논의. 도로에 저촉된 토지는 보상 대상이 될 수 있습니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#ca8a0418", color: "#ca8a04", borderColor: "#ca8a0430" }}>택지</span></dt>
                                    <dd>택지개발 관련 논의. 대규모 토지 수용과 보상이 수반되는 사업입니다.</dd>
                                </dl>
                            </div>

                            <div className={styles.helpSection}>
                                <h4>고시/인허가 태그</h4>
                                <p className={styles.helpSectionDesc}>토지이음(EUM) 시스템에서 조회한 해당 지역의 공식 고시·인허가 정보입니다.</p>
                                <dl className={styles.helpList}>
                                    <dt><span className={styles.helpPill} style={{ background: "#b91c1c18", color: "#b91c1c", borderColor: "#b91c1c30", fontWeight: 600 }}>고시 N건</span></dt>
                                    <dd>해당 지역에 관련된 정부/지자체 고시 건수. 도시계획시설 결정, 실시계획 인가, 사업인정 등이 포함됩니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#7c3aed18", color: "#7c3aed", borderColor: "#7c3aed30", fontWeight: 600 }}>인허가 N건</span></dt>
                                    <dd>개발행위 허가, 건축허가 등 해당 지역의 인허가 건수. 주변 개발 활동의 활발도를 나타냅니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#dc262618", color: "#dc2626", borderColor: "#dc262630", fontWeight: 600 }}>번지 매칭</span></dt>
                                    <dd>고시가 해당 물건의 정확한 번지와 일치. 해당 토지가 사업에 직접 포함될 가능성이 매우 높습니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#ea580c18", color: "#ea580c", borderColor: "#ea580c30", fontWeight: 600 }}>리/동 매칭</span></dt>
                                    <dd>고시가 같은 리/동 단위에서 매칭. 번지 매칭보다는 약하지만 인근 사업의 영향권에 있음을 의미합니다.</dd>
                                </dl>
                            </div>

                            <div className={styles.helpSection}>
                                <h4>사업 단계 (고시 기반)</h4>
                                <p className={styles.helpSectionDesc}>토지이음 고시 정보를 기반으로 파악한 사업 진행 단계입니다. 단계가 높을수록 보상 시점이 가깝습니다.</p>
                                <dl className={styles.helpList}>
                                    <dt><span className={styles.helpPill} style={{ background: "#2563eb15", color: "#2563eb", borderColor: "#2563eb40" }}>결정</span></dt>
                                    <dd>도시계획시설 결정 고시 단계. 시설 설치가 결정되었으나 구체적 실행 계획은 아직 없는 초기 단계입니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#7c3aed15", color: "#7c3aed", borderColor: "#7c3aed40" }}>실시계획</span></dt>
                                    <dd>실시계획 인가 단계. 구체적인 사업 설계가 완료되어 실행 준비가 된 상태입니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#ea580c15", color: "#ea580c", borderColor: "#ea580c40" }}>사업인정</span></dt>
                                    <dd>사업인정 고시 단계. 토지 수용권이 부여되어 보상 협의가 시작될 수 있는 단계입니다.</dd>
                                    <dt><span className={styles.helpPill} style={{ background: "#dc262615", color: "#dc2626", borderColor: "#dc262640" }}>보상</span></dt>
                                    <dd>보상 단계. 토지 보상 협의 또는 수용 재결이 진행 중인 최종 단계입니다.</dd>
                                </dl>
                            </div>

                            <div className={styles.helpSection}>
                                <h4>상태 배지</h4>
                                <dl className={styles.helpList}>
                                    <dt><span className={styles.helpInlineBadge} style={{ background: "#fee2e2", color: "#dc2626" }}>보상 시그널</span></dt>
                                    <dd>회의록, 고시, 시설 정보를 종합했을 때 보상 가능성이 높다고 판단된 물건입니다.</dd>
                                    <dt><span className={styles.helpInlineBadge} style={{ background: "#fef3c7", color: "#92400e" }}>미집행</span></dt>
                                    <dd>도시계획시설로 결정되었으나 아직 집행(공사)이 되지 않은 상태. 장기 미집행 시설은 실효 또는 보상 대상이 됩니다.</dd>
                                </dl>
                            </div>

                            <div className={styles.helpSection}>
                                <h4>점수 구성 (4가지 요소)</h4>
                                <p className={styles.helpSectionDesc}>각 물건의 투자 매력도를 0~100%로 환산한 4가지 요소의 종합 점수입니다.</p>
                                <dl className={styles.helpList}>
                                    <dt><span style={{ color: "#2563eb", fontWeight: 700 }}>시설저촉 (40%)</span></dt>
                                    <dd>도시계획시설과의 관계. 포함(100점) &gt; 저촉(70점) &gt; 접합(30점) 순으로 점수가 높습니다.</dd>
                                    <dt><span style={{ color: "#7c3aed", fontWeight: 700 }}>경과연수 (15%)</span></dt>
                                    <dd>도시계획시설 결정 후 경과 기간. 18년 이상이면 만점으로, 장기 미집행 실효 대상 가능성을 반영합니다.</dd>
                                    <dt><span style={{ color: "#dc2626", fontWeight: 700 }}>사업단계 (30%)</span></dt>
                                    <dd>고시 기반 사업 진행도. 보상 단계(100점)가 가장 높고, 결정 단계로 갈수록 낮아집니다.</dd>
                                    <dt><span style={{ color: "#059669", fontWeight: 700 }}>유찰 (15%)</span></dt>
                                    <dd>유찰 횟수에 따른 가격 하락 보너스. 유찰이 많을수록 저가 매수 기회를 의미합니다.</dd>
                                </dl>
                            </div>

                            <div className={styles.helpSection}>
                                <h4>시설 관계 유형</h4>
                                <dl className={styles.helpList}>
                                    <dt><span style={{ fontWeight: 600 }}>포함</span></dt>
                                    <dd>토지가 도시계획시설 부지에 완전히 포함. 사업 시행 시 전체 보상 대상입니다.</dd>
                                    <dt><span style={{ fontWeight: 600 }}>저촉</span></dt>
                                    <dd>토지 일부가 시설 부지에 걸침. 저촉 부분에 대해 보상이 이뤄집니다.</dd>
                                    <dt><span style={{ fontWeight: 600 }}>접합</span></dt>
                                    <dd>토지가 시설 부지에 인접. 직접 보상 대상은 아니지만 주변 개발 수혜를 기대할 수 있습니다.</dd>
                                </dl>
                            </div>
                        </div>
                    </div>
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
                            {key === "score" ? "점수순" : key === "facility" ? "시설순" : key === "compensation" ? "보상순" : key === "facility_age" ? "경과연수" : "사업단계"}
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
                <button
                    className={styles.helpBtn}
                    onClick={() => setShowHelp(true)}
                    title="시그널 용어 안내"
                >
                    <HelpCircle size={16} />
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
                                                    background: item.notice_details?.some((n: NoticeDetail) => n.matchType === "lot")
                                                        ? "#dc262618" : "#ea580c18",
                                                    color: item.notice_details?.some((n: NoticeDetail) => n.matchType === "lot")
                                                        ? "#dc2626" : "#ea580c",
                                                    borderColor: item.notice_details?.some((n: NoticeDetail) => n.matchType === "lot")
                                                        ? "#dc262630" : "#ea580c30",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {item.notice_details?.some((n: NoticeDetail) => n.matchType === "lot")
                                                    ? "번지 매칭" : "리/동 매칭"}
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
