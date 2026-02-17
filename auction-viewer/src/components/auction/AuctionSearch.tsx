"use client";

import React, { useState } from "react";
import styles from "./AuctionSearch.module.css";

interface AuctionSearchProps {
    onSearch: (keyword: string) => void;
    onReset: () => void;
    hasActiveSearch: boolean;
}

export default function AuctionSearch({
    onSearch,
    onReset,
    hasActiveSearch,
}: AuctionSearchProps) {
    const [keyword, setKeyword] = useState("");

    const handleSearch = () => {
        onSearch(keyword);
    };

    const handleReset = () => {
        setKeyword("");
        onReset();
    };

    return (
        <div className={styles.container}>
            <input
                type="text"
                placeholder="전체 검색"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                }}
                className={styles.input}
            />
            <button onClick={handleSearch} className={styles.searchButton}>
                검색
            </button>
            {hasActiveSearch && (
                <button onClick={handleReset} className={styles.resetButton}>
                    검색 초기화
                </button>
            )}
        </div>
    );
}
