"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import styles from "./PropertySignals.module.css";
import { AuctionItem } from "@/types/auction";
import { Sparkles, Check, Loader, AlertCircle } from "lucide-react";

/** Reusable lightweight markdown → HTML (same as MinutesSearchPage) */
function renderMarkdown(md: string): string {
    const lines = md.split("\n");
    const html: string[] = [];
    let inList: "ul" | "ol" | null = null;

    const closeList = () => {
        if (inList) {
            html.push(inList === "ul" ? "</ul>" : "</ol>");
            inList = null;
        }
    };

    for (const line of lines) {
        if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) { closeList(); html.push("<hr />"); continue; }
        const hm = line.match(/^(#{1,4})\s+(.+)$/);
        if (hm) { closeList(); html.push(`<h${hm[1].length}>${inlineFmt(hm[2])}</h${hm[1].length}>`); continue; }
        const ulm = line.match(/^(\s*)[-*•]\s+(.+)$/);
        if (ulm) { if (inList !== "ul") { closeList(); html.push("<ul>"); inList = "ul"; } html.push(`<li>${inlineFmt(ulm[2])}</li>`); continue; }
        const olm = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olm) { if (inList !== "ol") { closeList(); html.push("<ol>"); inList = "ol"; } html.push(`<li>${inlineFmt(olm[2])}</li>`); continue; }
        if (line.startsWith("> ")) { closeList(); html.push(`<blockquote>${inlineFmt(line.slice(2))}</blockquote>`); continue; }
        if (line.trim() === "") { closeList(); html.push("<br />"); continue; }
        closeList(); html.push(`<p>${inlineFmt(line)}</p>`);
    }
    closeList();
    return html.join("\n");
}

function inlineFmt(t: string): string {
    return t
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
}

interface SignalData {
    location: { sido: string; sigungu: string; dong?: string } | null;
    councils: { name: string; code: string }[];
    signals: { keyword: string; doc_count: number; signal_summary?: string }[];
    urbanPlanFacilities: {
        facilityName: string;
        facilityType: string;
        decisionDate?: string;
        executionStatus?: string;
    }[];
    hasSignals: boolean;
}

interface ProgressStep {
    step: number;
    message: string;
    status: "pending" | "active" | "done";
}

const ANALYSIS_STEPS = ["검색어 생성", "회의록 검색", "본문 수집", "관련 내용 분석", "AI 분석 결과 생성"];

export default function PropertySignals({ row }: { row: AuctionItem }) {
    const [signalData, setSignalData] = useState<SignalData | null>(null);
    const [signalLoading, setSignalLoading] = useState(true);
    const [signalError, setSignalError] = useState<string | null>(null);

    const [analysisResult, setAnalysisResult] = useState<string | null>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisSteps, setAnalysisSteps] = useState<ProgressStep[]>([]);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const renderedResult = useMemo(
        () => (analysisResult ? renderMarkdown(analysisResult) : ""),
        [analysisResult]
    );

    // Layer 1+2+3: Fetch signals on mount
    useEffect(() => {
        const address = String(row["주소"] || "");
        const pnu = String(row["PNU"] || "");
        if (!address) {
            setSignalLoading(false);
            return;
        }

        const params = new URLSearchParams({ address });
        if (pnu) params.set("pnu", pnu);

        fetch(`/api/auction-signals?${params}`)
            .then((res) => {
                if (!res.ok) throw new Error("시그널 조회 실패");
                return res.json();
            })
            .then((data: SignalData) => {
                setSignalData(data);
                setSignalLoading(false);
            })
            .catch((err) => {
                setSignalError(err.message);
                setSignalLoading(false);
            });
    }, [row]);

    // Layer 4: Deep analysis via SSE
    const processSSEEvent = useCallback((event: {
        type: string;
        step: number;
        message: string;
        data?: string;
    }) => {
        if (event.type === "error") {
            setAnalysisError(event.message);
            setAnalysisLoading(false);
            return;
        }

        setAnalysisSteps((prev: ProgressStep[]) => prev.map((s: ProgressStep) => {
            if (s.step < event.step) return { ...s, status: "done" as const };
            if (s.step === event.step) return { ...s, message: event.message, status: "active" as const };
            return s;
        }));

        if (event.type === "partial_result" && event.data) {
            setAnalysisResult(event.data);
        }

        if (event.type === "done") {
            if (event.data) setAnalysisResult(event.data);
            setAnalysisSteps((prev: ProgressStep[]) => prev.map((s: ProgressStep) => ({ ...s, status: "done" as const })));
        }
    }, []);

    const handleDeepAnalysis = useCallback(async () => {
        if (!signalData) return;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setAnalysisLoading(true);
        setAnalysisResult(null);
        setAnalysisError(null);
        setAnalysisSteps(ANALYSIS_STEPS.map((label, i) => ({
            step: i + 1,
            message: label,
            status: i === 0 ? "active" : "pending",
        })));

        try {
            const response = await fetch("/api/auction-signals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    address: String(row["주소"] || ""),
                    pnu: String(row["PNU"] || ""),
                    dong: signalData.location?.dong || String(row["동"] || ""),
                    councilCodes: signalData.councils.map((c) => c.code),
                    urbanPlanFacilities: signalData.urbanPlanFacilities,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                setAnalysisError("심층 분석 요청 실패");
                setAnalysisLoading(false);
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
                setAnalysisError("스트리밍 응답 불가");
                setAnalysisLoading(false);
                return;
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const jsonStr = line.slice(6);
                    if (!jsonStr.trim()) continue;
                    try {
                        const event = JSON.parse(jsonStr);
                        processSSEEvent(event);
                    } catch { /* ignore */ }
                }
            }

            if (buffer.startsWith("data: ")) {
                try {
                    const event = JSON.parse(buffer.slice(6));
                    processSSEEvent(event);
                } catch { /* ignore */ }
            }
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                setAnalysisError("서버 연결 실패");
            }
        } finally {
            setAnalysisLoading(false);
        }
    }, [signalData, row, processSSEEvent]);

    const address = String(row["주소"] || "-");
    const pnu = String(row["PNU"] || "");

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <span className={styles.address}>{address}</span>
                {pnu && <span className={styles.pnu}>PNU: {pnu}</span>}
            </div>

            <div className={styles.sections}>
                {/* Layer 1: 관할 의회 */}
                <div className={styles.section}>
                    <div className={styles.sectionLabel}>관할 의회</div>
                    {signalLoading ? (
                        <span className={styles.loadingDots}>조회 중...</span>
                    ) : signalError ? (
                        <span className={styles.errorText}>
                            <AlertCircle size={14} />
                            {signalError}
                        </span>
                    ) : signalData?.councils.length ? (
                        <div className={styles.councilList}>
                            {signalData.councils.map((c) => (
                                <span key={c.code} className={styles.councilBadge}>
                                    {c.name}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <span className={styles.noSignals}>매핑된 의회 없음</span>
                    )}
                </div>

                {/* Layer 2: 지역 시그널 */}
                {signalData && signalData.signals.length > 0 && (
                    <div className={styles.section}>
                        <div className={styles.sectionLabel}>지역 시그널</div>
                        {signalData.signals.map((s, i) => (
                            <div key={i} className={styles.signalItem}>
                                <span className={styles.signalDot} />
                                <span>&ldquo;{s.keyword}&rdquo; 관련 {s.doc_count}건</span>
                                {s.signal_summary && (
                                    <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                                        &mdash; {s.signal_summary}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Layer 3: 토지이용규제 */}
                {signalData && signalData.urbanPlanFacilities.length > 0 && (
                    <div className={styles.section}>
                        <div className={styles.sectionLabel}>토지이용규제</div>
                        {signalData.urbanPlanFacilities.map((f, i) => (
                            <div key={i} className={styles.facilityItem}>
                                <div>
                                    <div className={styles.facilityName}>
                                        {f.facilityName}
                                    </div>
                                    <div className={styles.facilityMeta}>
                                        {f.executionStatus && (
                                            <span
                                                className={`${styles.facilityBadge} ${
                                                    f.executionStatus === "가능"
                                                        ? styles.facilityBadgeActive
                                                        : styles.facilityBadgePending
                                                }`}
                                            >
                                                {f.executionStatus}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Layer 4: AI 심층 분석 */}
                <div className={styles.section}>
                    <div className={styles.sectionLabel}>AI 심층 분석</div>

                    {/* Progress steps */}
                    {analysisLoading && analysisSteps.length > 0 && (
                        <div className={styles.progressInline}>
                            {analysisSteps.map((s, i) => (
                                <React.Fragment key={s.step}>
                                    <span className={`${styles.progressChip} ${styles[`chip_${s.status}`]}`}>
                                        {s.status === "done" ? <Check size={12} /> : s.status === "active" ? <Loader size={12} className={styles.spinIcon} /> : null}
                                        <span>{s.message}</span>
                                    </span>
                                    {i < analysisSteps.length - 1 && <span className={styles.progressArrow}>&rarr;</span>}
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                    {analysisError && (
                        <div className={styles.errorCard}>
                            <AlertCircle size={20} />
                            <span>{analysisError}</span>
                        </div>
                    )}

                    {analysisResult && (
                        <section className={styles.resultContainer}>
                            <div className={styles.resultHeader}>
                                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)" }}>분석 결과</span>
                            </div>
                            <div
                                className={styles.resultCard}
                                dangerouslySetInnerHTML={{ __html: renderedResult }}
                            />
                        </section>
                    )}

                    {!analysisResult && (
                        <button
                            className={styles.analyzeButton}
                            onClick={handleDeepAnalysis}
                            disabled={!signalData || signalLoading || analysisLoading}
                        >
                            {analysisLoading ? (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <div className={styles.miniSpinner} />
                                    <span>분석 중...</span>
                                </div>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    <span>심층 분석</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
