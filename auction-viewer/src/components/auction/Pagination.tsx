import React from "react";
import styles from "./Pagination.module.css";

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

    const currentBlock = Math.floor((page - 1) / MAX_PAGE_BUTTONS);
    const startPage = currentBlock * MAX_PAGE_BUTTONS + 1;
    const endPage = Math.min(startPage + MAX_PAGE_BUTTONS - 1, totalPages);

    return (
        <div className={styles.container}>
            {page > 1 && (
                <button
                    onClick={() => onPageChange(page - 1)}
                    className={styles.navButton}
                >
                    이전
                </button>
            )}
            {Array.from({ length: endPage - startPage + 1 }, (_, i) => {
                const pageNum = startPage + i;
                const isCurrent = pageNum === page;
                return (
                    <button
                        key={pageNum}
                        onClick={() => onPageChange(pageNum)}
                        className={
                            isCurrent ? styles.pageButtonActive : styles.pageButton
                        }
                        disabled={isCurrent}
                    >
                        {pageNum}
                    </button>
                );
            })}
            {endPage < totalPages && (
                <span className={styles.ellipsis}>...</span>
            )}
            {page < totalPages && (
                <button
                    onClick={() => onPageChange(page + 1)}
                    className={styles.navButton}
                >
                    다음
                </button>
            )}
        </div>
    );
}
