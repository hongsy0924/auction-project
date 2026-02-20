/**
 * 경매 물건 데이터 타입
 * API 및 DB에서 사용되는 한글 컬럼명 기반
 */
export interface AuctionItem {
    고유키?: string;
    사건번호?: string;
    물건종류?: string;
    지목?: string;
    주소?: string;
    지번?: string;
    감정평가액?: string | number;
    최저매각가격?: string | number;
    "%"?: string | number;
    비고?: string;
    매각기일?: string;
    유찰회수?: string | number;
    매각결정기일?: string;
    건축물?: string;
    면적?: string;
    포함?: string;
    저촉?: string;
    접합?: string;
    토지이용계획및제한상태?: string;
    담당법원?: string;
    담당계?: string;
    전화번호?: string;
    [key: string]: string | number | undefined;
}

/** API /api/auction-list 응답 타입 */
export interface AuctionListResponse {
    data: AuctionItem[];
    total: number;
}

/** 테이블에 표시할 컬럼 설정 */
export const VISIBLE_COLUMNS = [
    "사건번호",
    "물건종류",
    "지목",
    "주소",
    "감정평가액",
    "최저매각가격",
    "%",
    "매각기일",
    "면적",
    "포함",
    "저촉",
    "접합",
] as const;

/** 숫자 포맷팅 대상 컬럼 */
export const NUMBER_COLUMNS = ["감정평가액", "최저매각가격"] as const;

/** Sticky(고정) 컬럼 목록 (순서 중요) */
export const FROZEN_COLUMNS = [
    "사건번호",
    "물건종류",
    "지목",
    "주소",
    "감정평가액",
    "최저매각가격",
    "%",
] as const;

/** 컬럼별 고정 너비 */
export const COLUMN_WIDTHS: Record<string, number> = {
    사건번호: 100,
    물건종류: 50,
    지목: 50,
    주소: 100,
    지번: 50,
    감정평가액: 100,
    최저매각가격: 100,
    "%": 30,
};
