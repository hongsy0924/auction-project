import React from "react";
import styles from "./AuctionTable.module.css";
import { AuctionItem, NUMBER_COLUMNS, COLUMN_WIDTHS } from "@/types/auction";
import AuctionTableRow from "./AuctionTableRow";
import PropertySignals from "./PropertySignals";

interface AuctionTableProps {
    data: AuctionItem[];
    columns: string[];
    stickyColumns: Record<string, number>;
    keyword: string;
    onReset: () => void;
    loading?: boolean;
    expandedDocId: string | null;
    onRowClick: (row: AuctionItem) => void;
}

export default function AuctionTable({
    data,
    columns,
    stickyColumns,
    keyword,
    onReset,
    loading = false,
    expandedDocId,
    onRowClick,
}: AuctionTableProps) {
    if (loading) {
        return (
            <div className={styles.wrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            {columns.map((col) => {
                                const isFrozen = col in stickyColumns;
                                return (
                                    <th
                                        key={col}
                                        className={isFrozen ? styles.headerCellFrozen : styles.headerCell}
                                        style={{
                                            left: isFrozen ? stickyColumns[col] : undefined,
                                            width: COLUMN_WIDTHS[col] || "auto",
                                        }}
                                    >
                                        {col}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: 10 }).map((_, i) => (
                            <tr key={i} className={styles.row}>
                                {columns.map((col) => {
                                    const isFrozen = col in stickyColumns;
                                    return (
                                        <td
                                            key={col}
                                            className={isFrozen ? styles.cellFrozen : styles.cell}
                                            style={{
                                                left: isFrozen ? stickyColumns[col] : undefined,
                                            }}
                                        >
                                            <div className="skeleton" style={{ height: "20px", width: "80%" }}></div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (!data.length) {
        return (
            <div className={styles.emptyState}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>🔍</div>
                <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-main)" }}>검색 결과가 없습니다.</div>
                <div style={{ color: "var(--text-muted)", marginTop: "4px" }}>다양한 검색어로 소중한 정보를 찾아보세요.</div>
                {keyword && (
                    <div style={{ marginTop: "20px" }}>
                        <button onClick={onReset} className={styles.emptyResetButton}>
                            검색 초기화
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={styles.wrapper}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        {columns.map((col) => {
                            const isFrozen = col in stickyColumns;
                            const isNumeric = (NUMBER_COLUMNS as unknown as string[]).includes(col) || col === "%";
                            return (
                                <th
                                    key={col}
                                    className={
                                        isFrozen ? styles.headerCellFrozen : styles.headerCell
                                    }
                                    style={{
                                        left: isFrozen ? stickyColumns[col] : undefined,
                                        minWidth: COLUMN_WIDTHS[col] || "auto",
                                        width: COLUMN_WIDTHS[col] || "auto",
                                        textAlign: isNumeric ? "right" : "left",
                                    }}
                                >
                                    {col}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => {
                        const docId = String(row["고유키"] || i);
                        const isExpanded = expandedDocId === docId;
                        return (
                            <React.Fragment key={docId}>
                                <AuctionTableRow
                                    row={row}
                                    columns={columns}
                                    stickyColumns={stickyColumns}
                                    keyword={keyword}
                                    numberColumns={NUMBER_COLUMNS as unknown as string[]}
                                    isExpanded={isExpanded}
                                    onRowClick={onRowClick}
                                />
                                {isExpanded && (
                                    <tr className={styles.expandedRow}>
                                        <td colSpan={columns.length} className={styles.expandedCell}>
                                            <PropertySignals row={row} />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
