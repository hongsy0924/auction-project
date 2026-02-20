import React from "react";
import styles from "./Pagination.module.css";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

const MAX_PAGE_BUTTONS = 20;

export default function Pagination({
    page,
    totalPages,
    onPageChange,
}: PaginationProps) {
    if (totalPages <= 1) return null;

    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        const buffer = 2; // Number of pages to show around current page

        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            if (page > buffer + 2) pages.push("...");

            const start = Math.max(2, page - buffer);
            const end = Math.min(totalPages - 1, page + buffer);

            for (let i = start; i <= end; i++) pages.push(i);

            if (page < totalPages - buffer - 1) pages.push("...");
            pages.push(totalPages);
        }
        return pages;
    };

    return (
        <div className={styles.container}>
            <button
                onClick={() => onPageChange(page - 1)}
                className={styles.navButton}
                disabled={page === 1}
            >
                <ChevronLeft size={16} />
                <span>이전</span>
            </button>
            <div className={styles.pageNumbers}>
                {getPageNumbers().map((pageNum, i) => {
                    const isEllipsis = pageNum === "...";
                    const isCurrent = pageNum === page;
                    return (
                        <button
                            key={i}
                            onClick={() => !isEllipsis && onPageChange(pageNum as number)}
                            className={
                                isCurrent
                                    ? styles.pageButtonActive
                                    : isEllipsis
                                        ? styles.ellipsisButton
                                        : styles.pageButton
                            }
                            disabled={isCurrent || isEllipsis}
                        >
                            {pageNum}
                        </button>
                    );
                })}
            </div>
            <button
                onClick={() => onPageChange(page + 1)}
                className={styles.navButton}
                disabled={page === totalPages}
            >
                <span>다음</span>
                <ChevronRight size={16} />
            </button>
        </div>
    );
}
