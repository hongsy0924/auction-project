import React from "react";
import styles from "./AuctionTable.module.css";
import { AuctionItem, NUMBER_COLUMNS, COLUMN_WIDTHS } from "@/types/auction";
import AuctionTableRow from "./AuctionTableRow";

interface AuctionTableProps {
    data: AuctionItem[];
    columns: string[];
    stickyColumns: Record<string, number>;
    keyword: string;
    onReset: () => void;
}

export default function AuctionTable({
    data,
    columns,
    stickyColumns,
    keyword,
    onReset,
}: AuctionTableProps) {
    if (!data.length) {
        return (
            <div className={styles.emptyState}>
                검색 결과가 없습니다.
                {keyword && (
                    <div>
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
                                    }}
                                >
                                    {col}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <AuctionTableRow
                            key={i}
                            row={row}
                            columns={columns}
                            stickyColumns={stickyColumns}
                            keyword={keyword}
                            numberColumns={NUMBER_COLUMNS as unknown as string[]}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
