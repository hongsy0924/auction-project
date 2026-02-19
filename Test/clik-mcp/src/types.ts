/**
 * CLIK Open API Types
 * Based on: https://clik.nanet.go.kr/potal/guide/resourceCenter.do
 * Response format verified against live API.
 */

// --- Request Types ---

export type SearchType =
    | "ALL"            // 전체 (All fields)
    | "MTR_SJ"         // 제목 (Title)
    | "MINTS_HTML"     // 내용 (Content)
    | "RASMBLY_NM"     // 의회명 (Council name)
    | "PRMPST_CMIT_NM"; // 위원회명 (Committee name)

export interface SearchMinutesParams {
    /** Search keyword (required) */
    keyword: string;
    /** Council code, e.g. "041009" for 서산시의회 */
    councilCode?: string;
    /** Which field to search (default: ALL) */
    searchType?: SearchType;
    /** Pagination offset, 0-based (default: 0) */
    startCount?: number;
    /** Results per page, max 100 (default: 10) */
    listCount?: number;
}

export interface GetMinuteDetailParams {
    /** Document ID from search results */
    docid: string;
}

// --- Response Types ---

/** A single row in the minutes search result list */
export interface MinuteListItem {
    /** Document ID (used to fetch detail) */
    DOCID: string;
    /** Council code */
    RASMBLY_ID: string;
    /** Council name (e.g. "충청남도 서산시의회") */
    RASMBLY_NM: string;
    /** Meeting name / title (e.g. "본회의") */
    MTGNM: string;
    /** Meeting date (YYYYMMDD) */
    MTG_DE: string;
    /** Council term number */
    RASMBLY_NUMPR: string;
    /** Session number */
    RASMBLY_SESN?: string;
    /** Meeting order number */
    MINTS_ODR?: string;
    /** Committee name */
    PRMPST_CMIT_NM?: string;
    /** Subject / agenda title */
    MTR_SJ?: string;
}

/** Detail response for a single minute */
export interface MinuteDetail extends MinuteListItem {
    /** Full transcript content (HTML) */
    MINTS_HTML: string;
}

/**
 * Top-level API response wrapper.
 * The API returns an array `[{ SERVICE, RESULT_CODE, ..., LIST: [{ROW: ...}, ...] }]`.
 */
export interface ClikApiResponseItem<T> {
    SERVICE: string;
    RESULT_CODE: string;
    RESULT_MESSAGE: string;
    TOTAL_COUNT: number;
    LIST_COUNT: number;
    /** Array of wrapped rows */
    LIST: Array<{ ROW: T }>;
}

/** The actual API response is an array of ClikApiResponseItem */
export type ClikApiResponse<T> = ClikApiResponseItem<T>[];
