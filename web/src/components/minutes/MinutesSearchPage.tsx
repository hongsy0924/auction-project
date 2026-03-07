"use client";

import React, { useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import styles from "./MinutesSearchPage.module.css";
import { ChevronLeft, Search, Sparkles, MessageSquare, AlertCircle, Check, Loader } from "lucide-react";

/**
 * Lightweight markdown → HTML converter.
 * Handles: headings, bold, italic, lists, hr, blockquotes, line breaks.
 */
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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Horizontal rule
        if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
            closeList();
            html.push("<hr />");
            continue;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            closeList();
            const level = headingMatch[1].length;
            html.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
            continue;
        }

        // Unordered list items (-, *, •)
        const ulMatch = line.match(/^(\s*)[-*•]\s+(.+)$/);
        if (ulMatch) {
            if (inList !== "ul") {
                closeList();
                html.push("<ul>");
                inList = "ul";
            }
            html.push(`<li>${inlineFormat(ulMatch[2])}</li>`);
            continue;
        }

        // Ordered list items
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olMatch) {
            if (inList !== "ol") {
                closeList();
                html.push("<ol>");
                inList = "ol";
            }
            html.push(`<li>${inlineFormat(olMatch[2])}</li>`);
            continue;
        }

        // Blockquote
        if (line.startsWith("> ")) {
            closeList();
            html.push(`<blockquote>${inlineFormat(line.slice(2))}</blockquote>`);
            continue;
        }

        // Empty line → paragraph break
        if (line.trim() === "") {
            closeList();
            html.push("<br />");
            continue;
        }

        // Regular paragraph
        closeList();
        html.push(`<p>${inlineFormat(line)}</p>`);
    }

    closeList();
    return html.join("\n");
}

/** Inline formatting: bold, italic, inline code, emoji-safe */
function inlineFormat(text: string): string {
    return text
        // Bold: **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        // Italic: *text* or _text_
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        // Inline code: `text`
        .replace(/`([^`]+)`/g, "<code>$1</code>");
}

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
                    <div className={styles.headerContent}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <Sparkles size={20} className="text-primary" style={{ color: "var(--primary)" }} />
                            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                AI Intelligence
                            </span>
                        </div>
                        <h1 className={styles.title}>회의록 검색</h1>
                        <p className={styles.subtitle}>
                            지방의회 회의록에서 사업 진행 시그널을 스마트하게 찾아보세요
                        </p>
                    </div>
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
                <div className={styles.progressContainer}>
                    <div className={styles.progressHeader}>
                        <Sparkles size={16} style={{ color: "var(--primary)" }} />
                        <span className={styles.progressTitle}>분석 진행 중</span>
                    </div>
                    <div className={styles.progressSteps}>
                        {steps.map((s: ProgressStep) => (
                            <div key={s.step} className={`${styles.progressStep} ${styles[`step_${s.status}`]}`}>
                                <div className={styles.stepIcon}>
                                    {s.status === "done" ? (
                                        <Check size={14} />
                                    ) : s.status === "active" ? (
                                        <Loader size={14} className={styles.spinIcon} />
                                    ) : (
                                        <span className={styles.stepDot} />
                                    )}
                                </div>
                                <span className={styles.stepLabel}>{s.message}</span>
                            </div>
                        ))}
                    </div>
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
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <Sparkles size={16} />
                            <span className={styles.resultLabel}>AI 분석 결과</span>
                        </div>
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
