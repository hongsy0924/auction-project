"use client";

import React, { useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import styles from "./MinutesSearchPage.module.css";
import { ChevronLeft, Search, MessageSquare, AlertCircle, Check, Loader } from "lucide-react";
import { renderMarkdown } from "@/utils/renderMarkdown";

interface ProgressStep {
    step: number;
    message: string;
    status: "pending" | "active" | "done";
}

const STEP_LABELS = ["쿼리 분석", "회의록 검색", "본문 수집", "관련 내용 분석", "AI 분석 결과 생성"];

export default function MinutesSearchPage({ embedded = false }: { embedded?: boolean }) {
    const [query, setQuery] = useState("");
    const [result, setResult] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [steps, setSteps] = useState<ProgressStep[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    const renderedResult = useMemo(
        () => (result ? renderMarkdown(result) : ""),
        [result]
    );

    const processSSEEvent = useCallback((event: {
        type: string;
        step: number;
        message: string;
        data?: string;
    }) => {
        if (event.type === "error") {
            setError(event.message);
            setLoading(false);
            return;
        }

        // Update step progress
        setSteps((prev: ProgressStep[]) => prev.map((s: ProgressStep) => {
            if (s.step < event.step) return { ...s, status: "done" as const };
            if (s.step === event.step) return { ...s, message: event.message, status: "active" as const };
            return s;
        }));

        // Handle streaming result
        if (event.type === "partial_result" && event.data) {
            setResult(event.data);
        }

        if (event.type === "done") {
            if (event.data) setResult(event.data);
            setSteps((prev: ProgressStep[]) => prev.map((s: ProgressStep) => ({ ...s, status: "done" as const })));
        }
    }, []);

    const handleSearch = useCallback(async () => {
        if (!query.trim()) return;

        // Abort any existing request
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setResult(null);
        setError(null);
        setSteps(STEP_LABELS.map((label, i) => ({
            step: i + 1,
            message: label,
            status: i === 0 ? "active" : "pending",
        })));

        try {
            const response = await fetch("/api/minutes-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query.trim() }),
                signal: controller.signal,
            });

            if (!response.ok) {
                let errorMsg = "요청에 실패했습니다.";
                try {
                    const data = await response.json();
                    errorMsg = data.error || errorMsg;
                } catch { /* ignore parse error */ }
                setError(errorMsg);
                setLoading(false);
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
                setError("스트리밍 응답을 읽을 수 없습니다.");
                setLoading(false);
                return;
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events from buffer
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const jsonStr = line.slice(6);
                    if (!jsonStr.trim()) continue;

                    try {
                        const event = JSON.parse(jsonStr);
                        processSSEEvent(event);
                    } catch {
                        // Ignore malformed JSON
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.startsWith("data: ")) {
                try {
                    const event = JSON.parse(buffer.slice(6));
                    processSSEEvent(event);
                } catch { /* ignore */ }
            }
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                setError("서버 연결에 실패했습니다. 다시 시도해주세요.");
            }
        } finally {
            setLoading(false);
        }
    }, [query, processSSEEvent]);

    return (
        <main className={styles.container}>
            {!embedded && (
                <div className={styles.header}>
                    <Link href="/" className={styles.backLink}>
                        <ChevronLeft size={16} />
                        <span>목록으로</span>
                    </Link>
                    <h1 className={styles.title}>회의록 검색</h1>
                </div>
            )}

            <section className={styles.searchSection}>
                <div className={styles.inputWrapper}>
                    <MessageSquare size={18} className={styles.searchIcon} />
                    <textarea
                        className={styles.textarea}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`예: "서산시에서 석지제 사업 관련 언급이 있어? 예산 배정이라든지 사업이 진척되고 있다는 시그널을 찾고 싶어."`}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSearch();
                            }
                        }}
                        disabled={loading}
                    />
                </div>
                <div className={styles.actions}>
                    <button
                        className={styles.searchButton}
                        onClick={handleSearch}
                        disabled={loading || !query.trim()}
                    >
                        {loading ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <div className={styles.miniSpinner} />
                                <span>분석 중...</span>
                            </div>
                        ) : (
                            <>
                                <Search size={18} />
                                <span>분석 시작</span>
                            </>
                        )}
                    </button>
                    <span className={styles.hint}>
                        Enter로 검색 · Shift+Enter로 줄바꿈
                    </span>
                </div>
            </section>

            {loading && steps.length > 0 && (
                <div className={styles.progressInline}>
                    {steps.map((s: ProgressStep, i: number) => (
                        <React.Fragment key={s.step}>
                            <span className={`${styles.progressChip} ${styles[`chip_${s.status}`]}`}>
                                {s.status === "done" ? <Check size={12} /> : s.status === "active" ? <Loader size={12} className={styles.spinIcon} /> : null}
                                <span>{s.message}</span>
                            </span>
                            {i < steps.length - 1 && <span className={styles.progressArrow}>→</span>}
                        </React.Fragment>
                    ))}
                </div>
            )}

            {error && (
                <div className={styles.errorCard}>
                    <AlertCircle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {result && (
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
        </main>
    );
}
