"""
SQLAlchemy ORM models for auction database tables.
Maps to the existing auction_list and auction_list_cleaned tables.
"""
from __future__ import annotations

from sqlalchemy import Column, String, Text
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


class AuctionRaw(Base):
    """
    크롤러 원본 데이터 테이블 (auction_list).
    API 응답의 모든 필드를 그대로 저장합니다.
    """
    __tablename__ = "auction_list"

    # 복합 PK 역할 (실제 API에서 고유 식별자)
    docid = Column(String, primary_key=True)

    # 사건 식별
    boCd = Column(Text)
    saNo = Column(Text)
    maemulSer = Column(Text)
    mokmulSer = Column(Text)
    srnSaNo = Column(Text)
    jpDeptCd = Column(Text)

    # 상태 정보
    jinstatCd = Column(Text)
    mulStatcd = Column(Text)
    mulJinYn = Column(Text)
    maemulUtilCd = Column(Text)
    mulBigo = Column(Text)

    # 금액 정보
    gamevalAmt = Column(Text)
    minmaePrice = Column(Text)
    yuchalCnt = Column(Text)
    maeAmt = Column(Text)
    inqCnt = Column(Text)
    gwansMulRegCnt = Column(Text)
    remaeordDay = Column(Text)
    ipchalGbncd = Column(Text)

    # 매각기일 정보
    maeGiil = Column(Text)
    maegyuljGiil = Column(Text)
    maeHh1 = Column(Text)
    maeHh2 = Column(Text)
    maeHh3 = Column(Text)
    maeHh4 = Column(Text)

    # 최저매각가격 (분할)
    notifyMinmaePrice1 = Column(Text)
    notifyMinmaePrice2 = Column(Text)
    notifyMinmaePrice3 = Column(Text)
    notifyMinmaePrice4 = Column(Text)
    notifyMinmaePriceRate1 = Column(Text)
    notifyMinmaePriceRate2 = Column(Text)

    # 입찰 정보
    maeGiilCnt = Column(Text)
    ipgiganFday = Column(Text)
    ipgiganTday = Column(Text)
    maePlace = Column(Text)
    spJogCd = Column(Text)
    mokGbncd = Column(Text)
    jongCd = Column(Text)
    stopsaGbncd = Column(Text)

    # 주소 — 행정구역 코드
    daepyoSidoCd = Column(Text)
    daepyoSiguCd = Column(Text)
    daepyoDongCd = Column(Text)
    daepyoRdCd = Column(Text)
    hjguSido = Column(Text)
    hjguSigu = Column(Text)
    hjguDong = Column(Text)
    hjguRd = Column(Text)
    daepyoLotno = Column(Text)

    # 건물/물건 상세
    buldNm = Column(Text)
    buldList = Column(Text)
    areaList = Column(Text)
    jimokList = Column(Text)
    lclsUtilCd = Column(Text)
    mclsUtilCd = Column(Text)
    sclsUtilCd = Column(Text)

    # 차량 관련 (부동산 외)
    jejosaNm = Column(Text)
    fuelKindcd = Column(Text)
    bsgFormCd = Column(Text)
    carNm = Column(Text)
    carYrtype = Column(Text)

    # 좌표
    xCordi = Column(Text)
    yCordi = Column(Text)
    cordiLvl = Column(Text)

    # 입찰장소 주소
    bgPlaceSidoCd = Column(Text)
    bgPlaceSiguCd = Column(Text)
    bgPlaceDongCd = Column(Text)
    bgPlaceRdCd = Column(Text)
    bgPlaceLotno = Column(Text)
    bgPlaceSido = Column(Text)
    bgPlaceSigu = Column(Text)
    bgPlaceDong = Column(Text)
    bgPlaceRd = Column(Text)

    # 검색용 필드
    srchHjguBgFlg = Column(Text)
    pjbBuldList = Column(Text)
    minArea = Column(Text)
    maxArea = Column(Text)
    groupmaemulser = Column(Text)
    bocdsano = Column(Text)
    dupSaNo = Column(Text)
    byungSaNo = Column(Text)
    srchLclsUtilCd = Column(Text)
    srchMclsUtilCd = Column(Text)
    srchSclsUtilCd = Column(Text)
    srchHjguSidoCd = Column(Text)
    srchHjguSiguCd = Column(Text)
    srchHjguDongCd = Column(Text)
    srchHjguRdCd = Column(Text)
    srchHjguLotno = Column(Text)

    # 법원 정보
    jiwonNm = Column(Text)
    jpDeptNm = Column(Text)
    tel = Column(Text)

    # 기타
    maejibun = Column(Text)
    wgs84Xcordi = Column(Text)
    wgs84Ycordi = Column(Text)
    rd1Cd = Column(Text)
    rd2Cd = Column(Text)
    rd3Rd4Cd = Column(Text)
    rd1Nm = Column(Text)
    rd2Nm = Column(Text)
    rdEubMyun = Column(Text)
    rdNm = Column(Text)
    buldNo = Column(Text)
    rdAddrSub = Column(Text)
    addrGbncd = Column(Text)
    bgPlaceRdAllAddr = Column(Text)
    bgPlaceAddrGbncd = Column(Text)
    srchRd1Cd = Column(Text)
    srchRd2Cd = Column(Text)
    srchRd3Rd4Cd = Column(Text)
    alias = Column(Text)
    dummyField = Column(Text)
    dspslUsgNm = Column(Text)
    convAddr = Column(Text)
    printSt = Column(Text)
    printCsNo = Column(Text)
    colMerge = Column(Text)

    # 토지이용정보 (PNU 기반 조회 결과)
    pnu = Column(Text)
    land_use_1 = Column(Text)
    land_use_2 = Column(Text)
    land_use_3 = Column(Text)
    land_use_combined = Column(Text)

    def __repr__(self) -> str:
        return f"<AuctionRaw(docid={self.docid!r}, srnSaNo={self.srnSaNo!r})>"


class AuctionCleaned(Base):
    """
    정리된 경매 데이터 테이블 (auction_list_cleaned).
    한글 컬럼명으로 매핑된 주요 필드만 포함합니다.
    """
    __tablename__ = "auction_list_cleaned"

    # 사건번호는 중복될 수 있으므로 (물건번호가 다름), docid를 고유키로 사용
    고유키 = Column("고유키", String, primary_key=True)

    사건번호 = Column("사건번호", Text)
    물건종류 = Column("물건종류", Text)
    지목 = Column("지목", Text)
    주소 = Column("주소", Text)
    지번 = Column("지번", Text)
    감정평가액 = Column("감정평가액", Text)
    최저매각가격 = Column("최저매각가격", Text)
    퍼센트 = Column("%", Text)
    비고 = Column("비고", Text)
    매각기일 = Column("매각기일", Text)
    유찰회수 = Column("유찰회수", Text)
    매각결정기일 = Column("매각결정기일", Text)
    건축물 = Column("건축물", Text)
    면적 = Column("면적", Text)
    포함 = Column("포함", Text)
    저촉 = Column("저촉", Text)
    접합 = Column("접합", Text)
    토지이용계획및제한상태 = Column("토지이용계획및제한상태", Text)
    담당법원 = Column("담당법원", Text)
    담당계 = Column("담당계", Text)
    전화번호 = Column("전화번호", Text)

    def __repr__(self) -> str:
        return f"<AuctionCleaned(사건번호={self.사건번호!r}, 주소={self.주소!r})>"
