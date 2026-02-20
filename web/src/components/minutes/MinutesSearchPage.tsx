"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import styles from "./MinutesSearchPage.module.css";

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

export default function MinutesSearchPage() {
    const [query, setQuery] = useState("");
    const [result, setResult] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const renderedResult = useMemo(
        () => (result ? renderMarkdown(result) : ""),
        [result]
    );

    const handleSearch = async () => {
        if (!query.trim()) return;

        setLoading(true);
        setResult(null);
        setError(null);

        try {
            const response = await fetch("/api/minutes-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query.trim() }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || "요청에 실패했습니다.");
                return;
            }

            setResult(data.result);
        } catch {
            setError("서버 연결에 실패했습니다. 다시 시도해주세요.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Link href="/" className={styles.backLink}>
                    ← 목록
                </Link>
                <div>
                    <h1 className={styles.title}>회의록 검색</h1>
                    <p className={styles.subtitle}>
                        지방의회 회의록에서 사업 진행 시그널을 찾아보세요
                    </p>
                </div>
            </div>

            <div className={styles.inputArea}>
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
                <div className={styles.actions}>
                    <button
                        className={styles.searchButton}
                        onClick={handleSearch}
                        disabled={loading || !query.trim()}
                    >
                        {loading ? "분석 중..." : "검색"}
                    </button>
                    <span className={styles.hint}>
                        Enter로 검색 · Shift+Enter로 줄바꿈
                    </span>
                </div>
            </div>

            {loading && (
                <div className={styles.loading}>
                    <div className={styles.spinner} />
                    <span className={styles.loadingText}>
                        회의록을 분석하고 있습니다... 1-2분 정도 소요됩니다.
                    </span>
                </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            {result && (
                <div>
                    <div className={styles.resultLabel}>분석 결과</div>
                    <div
                        className={styles.resultArea}
                        dangerouslySetInnerHTML={{ __html: renderedResult }}
                    />
                </div>
            )}
        </div>
    );
}
