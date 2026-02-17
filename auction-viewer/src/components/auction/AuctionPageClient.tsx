"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
    AuctionItem,
    AuctionListResponse,
    VISIBLE_COLUMNS,
    FROZEN_COLUMNS,
    COLUMN_WIDTHS,
} from "@/types/auction";
import AuctionSearch from "./AuctionSearch";
import AuctionTable from "./AuctionTable";
import Pagination from "./Pagination";

export default function AuctionPageClient() {
    const [data, setData] = useState<AuctionItem[]>([]);
    const [page, setPage] = useState(1);
    const [perPage] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [appliedKeyword, setAppliedKeyword] = useState("");

    useEffect(() => {
        setLoading(true);
        const params = new URLSearchParams({
            page: page.toString(),
            per_page: perPage.toString(),
            ...(appliedKeyword ? { keyword: appliedKeyword } : {}),
        });
        fetch(`/api/auction-list?${params}`)
            .then((res) => res.json())
            .then((res: AuctionListResponse) => {
                setData(Array.isArray(res.data) ? res.data : []);
                setTotal(res.total);
                setLoading(false);
            });
    }, [page, perPage, appliedKeyword]);

    // 데이터에서 실제 존재하는 컬럼만 필터링
    const columns = useMemo(() => {
        const allAvailable = data.length > 0 ? Object.keys(data[0]) : [];
        return [...VISIBLE_COLUMNS].filter((col) => allAvailable.includes(col));
    }, [data]);

    // stickyColumns의 left 값을 누적합으로 계산
    const stickyColumns = useMemo(() => {
        const result: Record<string, number> = {};
        let left = 0;
        for (const col of FROZEN_COLUMNS) {
            if (columns.includes(col)) {
                result[col] = left;
                left += COLUMN_WIDTHS[col] || 100;
            }
        }
        return result;
    }, [columns]);

    const totalPages = Math.ceil(total / perPage);

    const handleSearch = (keyword: string) => {
        setPage(1);
        setAppliedKeyword(keyword);
    };

    const handleReset = () => {
        setPage(1);
        setAppliedKeyword("");
    };

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
                로딩 중...
            </div>
        );
    }

    return (
        <div style={{ padding: 24 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                목록 (총 {total}건)
            </h1>
            <AuctionSearch
                onSearch={handleSearch}
                onReset={handleReset}
                hasActiveSearch={!!appliedKeyword}
            />
            <AuctionTable
                data={data}
                columns={columns}
                stickyColumns={stickyColumns}
                keyword={appliedKeyword}
                onReset={handleReset}
            />
            <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
            />
        </div>
    );
}
