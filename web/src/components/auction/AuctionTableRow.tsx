import React, { memo } from "react";
import styles from "./AuctionTable.module.css";
import { AuctionItem, COLUMN_WIDTHS } from "@/types/auction";

interface AuctionTableRowProps {
    row: AuctionItem;
    columns: string[];
    stickyColumns: Record<string, number>;
    keyword: string;
    numberColumns: string[];
}

function highlightKeyword(text: string, keyword: string) {
    if (!keyword) return text;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
            <mark key={i} className={styles.highlight}>
                {part}
            </mark>
        ) : (
            part
        )
    );
}

function AuctionTableRow({
    row,
    columns,
    stickyColumns,
    keyword,
    numberColumns,
}: AuctionTableRowProps) {
    return (
        <tr
            className={styles.row}
            onClick={() => {
                // Placeholder for detail view or row action
                console.log("Row clicked:", row["사건번호"]);
            }}
        >
            {columns.map((col, j) => {
                let value: string | number | undefined = row[col];

                if (value == null || value === "") {
                    value = "-";
                } else {
                    if (numberColumns.includes(col) && !isNaN(Number(value))) {
                        value = Number(value).toLocaleString();
                    }
                    if (col === "%") {
                        value = `${value}%`;
                    }
                }

                const isFrozen = col in stickyColumns;
                const isNumeric = numberColumns.includes(col) || col === "%";

                return (
                    <td
                        key={j}
                        className={isFrozen ? styles.cellFrozen : styles.cell}
                        style={{
                            left: isFrozen ? stickyColumns[col] : undefined,
                            minWidth: COLUMN_WIDTHS[col] || "auto",
                            width: COLUMN_WIDTHS[col] || "auto",
                            textAlign: isNumeric ? "right" : "left",
                        }}
                    >
                        {highlightKeyword(String(value), keyword)}
                    </td>
                );
            })}
        </tr>
    );
}

export default memo(AuctionTableRow);
