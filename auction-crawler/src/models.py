"""
Pydantic models for auction crawler data structures.
Provides type-safe representations of API requests, responses, and auction items.
"""
from __future__ import annotations

import datetime
from typing import Any

from pydantic import BaseModel, Field


class PageInfo(BaseModel):
    """API 페이지네이션 정보"""
    pageNo: int = 1
    pageSize: int = 40
    totalYn: str = "Y"
    totalCnt: int | None = None

    @property
    def total_pages(self) -> int:
        """전체 페이지 수 계산"""
        if self.totalCnt is None or self.totalCnt == 0:
            return 0
        return (self.totalCnt + self.pageSize - 1) // self.pageSize


class SearchParams(BaseModel):
    """경매 검색 파라미터"""
    bidDvsCd: str = "000331"
    mvprpRletDvsCd: str = "00031R"
    cortAuctnSrchCondCd: str = "0004601"
    lclDspslGdsLstUsgCd: str = "10000"
    mclDspslGdsLstUsgCd: str = "10100"
    cortStDvs: str = "1"
    statNum: int = 1
    bidBgngYmd: str = ""
    bidEndYmd: str = ""
    cortCd: str = ""
    cortNm: str = ""
    jpDeptCd: str = ""
    jpDeptNm: str = ""
    rletGdsLoc: str = ""
    rletGdsNo: str = ""
    rletAucDscn: str = ""
    rletGdsUsg: str = ""
    rletGdsApprAmt: str = ""
    rletGdsMinAmt: str = ""
    rletAucDscnDt: str = ""
    rletAucSts: str = ""

    @classmethod
    def with_date_range(cls, days_ahead: int = 14) -> SearchParams:
        """오늘부터 days_ahead일 후까지의 검색 파라미터 생성"""
        today = datetime.datetime.now().strftime('%Y%m%d')
        end_date = (datetime.datetime.now() + datetime.timedelta(days=days_ahead)).strftime('%Y%m%d')
        return cls(bidBgngYmd=today, bidEndYmd=end_date)


class AuctionApiRequest(BaseModel):
    """경매 API 요청 본문"""
    dma_pageInfo: dict[str, Any]
    dma_srchGdsDtlSrchInfo: dict[str, Any]

    @classmethod
    def create(cls, page: int, page_size: int, search_params: SearchParams | None = None) -> AuctionApiRequest:
        """API 요청 생성"""
        if search_params is None:
            search_params = SearchParams.with_date_range()

        # 모델 덤프 시 exclude_none=True 등을 사용하지 않고 모든 필드를 포함
        # API가 빈 문자열을 기대하는 경우가 많음
        return cls(
            dma_pageInfo={"pageNo": page, "pageSize": page_size, "totalYn": "Y"},
            dma_srchGdsDtlSrchInfo=search_params.model_dump()
        )


class CrawlResult(BaseModel):
    """단일 페이지 크롤링 결과"""
    page_num: int
    auctions: list[dict[str, Any]] | None = None
    page_info: dict[str, Any] = Field(default_factory=dict)
    is_blocked: bool = False
    error: str | None = None

    @property
    def is_success(self) -> bool:
        return self.auctions is not None and len(self.auctions) > 0

    @property
    def auction_count(self) -> int:
        return len(self.auctions) if self.auctions else 0


# 컬럼 매핑 (크롤러 → 한글, sqlite_cleaning과 공유)
COLUMN_MAPPING: dict[str, str] = {
    "srnSaNo": "사건번호",
    "dspslUsgNm": "물건종류",
    "jimokList": "지목",
    "printSt": "주소",
    "daepyoLotno": "지번",
    "gamevalAmt": "감정평가액",
    "notifyMinmaePrice1": "최저매각가격",
    "notifyMinmaePriceRate2": "%",
    "mulBigo": "비고",
    "maeGiil": "매각기일",
    "yuchalCnt": "유찰회수",
    "maegyuljgiil": "매각결정기일",
    "pjbBuldList": "건축물",
    "areaList": "면적",
    "land_use_1": "포함",
    "land_use_2": "저촉",
    "land_use_3": "접합",
    "land_use_combined": "토지이용계획및제한상태",
    "jiwonNm": "담당법원",
    "jpDeptNm": "담당계",
    "tel": "전화번호",
    "docid": "고유키",
}
