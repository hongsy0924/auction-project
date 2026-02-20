"use client";

import React, { useState } from "react";
import styles from "./AuctionSearch.module.css";
import { Search, X, RotateCcw } from "lucide-react";

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
            <div className={styles.inputWrapper}>
                <Search size={18} className={styles.searchIcon} />
                <input
                    type="text"
                    placeholder="사건번호, 주소, 물건종류 등 검색..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch();
                    }}
                    className={styles.input}
                />
                {keyword && (
                    <button
                        onClick={() => setKeyword("")}
                        className={styles.clearIcon}
                        title="지우기"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            <div className={styles.buttonGroup}>
                <button onClick={handleSearch} className={styles.searchButton}>
                    <Search size={16} />
                    <span>검색</span>
                </button>

                {hasActiveSearch && (
                    <button onClick={handleReset} className={styles.resetButton}>
                        <RotateCcw size={16} />
                        <span>초기화</span>
                    </button>
                )}
            </div>
        </div>
    );
}
