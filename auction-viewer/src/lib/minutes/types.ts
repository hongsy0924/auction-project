/**
 * CLIK Open API Types
 * Based on: https://clik.nanet.go.kr/potal/guide/resourceCenter.do
 */

export type SearchType =
    | "ALL"
    | "MTR_SJ"
    | "MINTS_HTML"
    | "RASMBLY_NM"
    | "PRMPST_CMIT_NM";

export interface SearchMinutesParams {
    keyword: string;
    councilCode?: string;
    searchType?: SearchType;
    startCount?: number;
    listCount?: number;
}

export interface MinuteListItem {
    DOCID: string;
    RASMBLY_ID: string;
    RASMBLY_NM: string;
    MTGNM: string;
    MTG_DE: string;
    RASMBLY_NUMPR: string;
    RASMBLY_SESN?: string;
    MINTS_ODR?: string;
    PRMPST_CMIT_NM?: string;
    MTR_SJ?: string;
}

export interface MinuteDetail extends MinuteListItem {
    MINTS_HTML: string;
}

export interface ClikApiResponseItem<T> {
    SERVICE: string;
    RESULT_CODE: string;
    RESULT_MESSAGE: string;
    TOTAL_COUNT: number;
    LIST_COUNT: number;
    LIST: Array<{ ROW: T }>;
}

export type ClikApiResponse<T> = ClikApiResponseItem<T>[];
