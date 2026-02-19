# 회의록 검색 아키텍처 최적화 — Progress

> Branch: `feature/mcp-search-optimization`
> Last updated: 2026-02-19

---

## 배경

기존 시스템의 한계:
- **단순 키워드 매칭** (`indexOf`) → 동의어/유사 표현 검색 불가
- **3,000자 고정 윈도잉** → 화자·안건 경계를 무시하고 텍스트 절단
- **화자 상실** → 잘린 청크에서 누가 발언했는지 알 수 없음

Gemini Deep Research 기반으로 **인메모리 하이브리드 검색 아키텍처**로 전환.

---

## ✅ 완료된 작업

### Phase 1: 구조 인식 청킹 (Structure-Aware Chunking)
- `src/chunker.ts` — TypeScript 구현
- `search-service/chunker.py` — Python 포트
- 화자(`◆`) / 안건(`【】`) / 문단 / 문장 경계 인식
- 모든 청크에 `speaker`, `agendaContext` 메타데이터 보존
- ✅ 테스트 통과: 7명 화자 → 7개 청크, 각 화자 정확히 보존

### Phase 2: Python 검색 마이크로서비스
- `search-service/searcher.py` — BM25(bm25s) + FAISS(벡터) + RRF 융합
- `search-service/server.py` — FastAPI HTTP 엔드포인트 (`POST /search`)
- `search-service/requirements.txt` — 의존성 (설치 완료, `.venv/` 생성됨)
- ✅ 키워드 테스트: "석지제 예산 배정" → 정확히 관련 발언 #1, #2
- ✅ 동의어 테스트: "무상급식 예산 삭감" → "학교 급식 지원금" 발언 찾아냄 (기존 방식으론 불가능)

### Phase 3: Contextual Retrieval
- `search-service/contextual.py` — Gemini Flash로 청크별 전역 맥락 주입
- `server.py`에 통합 (옵션으로 on/off 가능)

### Phase 4: 워크플로우 통합
- `src/workflow.ts` — Python 검색 서비스 호출 + 레거시 폴백
- `src/index.ts` — `search_and_analyze_minutes` MCP 도구 추가 (v2.0)
- ✅ TypeScript 컴파일 에러 없음

### Phase 5: Auction-Viewer 동기화
- `auction-viewer/src/lib/minutes/workflow.ts` 업데이트 완료

---

## 🔲 남은 작업

### 1. E2E 통합 테스트 (실제 CLIK API 연동)
Python 검색 서비스를 실행한 상태에서 실제 CLIK API 데이터로 전체 파이프라인 테스트:
```bash
# 터미널 1: Python 서비스 시작
cd test/clik-mcp/search-service
source .venv/bin/activate
GEMINI_API_KEY=your_key python server.py

# 터미널 2: CLI 테스트
cd test/clik-mcp
SEARCH_SERVICE_URL=http://localhost:8100 \
CLIK_API_KEY=your_key \
GEMINI_API_KEY=your_key \
npx tsx src/run-service.ts "서산시에서 석지제 사업 관련 예산 배정 논의"
```

### 2. 환경변수 설정
`.env` 파일에 `SEARCH_SERVICE_URL=http://localhost:8100` 추가 필요

### 3. Web UI 테스트
auction-viewer에서 회의록 검색 페이지 접속 → 쿼리 실행 → 결과 확인

### 4. (선택) 성능 최적화
- 임베딩 모델 warm-up: 첫 요청에만 ~20초 소요, 이후 ~1초
- 청크 수 / `top_k` 튜닝
- Contextual Retrieval 활성화 시 비용/지연 모니터링

### 5. (선택) 배포
- Python 서비스를 Docker 컨테이너 또는 별도 서버에 배포
- auction-viewer의 `SEARCH_SERVICE_URL`을 배포된 주소로 변경

---

## 파일 구조

```
test/clik-mcp/
├── src/
│   ├── index.ts          # MCP 서버 (v2.0, search_and_analyze_minutes 도구 추가)
│   ├── workflow.ts       # 파이프라인 (Python 서비스 호출 + 레거시 폴백)
│   ├── chunker.ts        # [NEW] TS 구조 인식 청커
│   ├── clik-client.ts    # CLIK API 클라이언트 (변경 없음)
│   ├── llm.ts            # Gemini LLM 연동 (변경 없음)
│   └── ...
├── search-service/       # [NEW] Python 검색 마이크로서비스
│   ├── server.py         # FastAPI 서버
│   ├── searcher.py       # BM25 + FAISS + RRF
│   ├── chunker.py        # Python 청커
│   ├── contextual.py     # Contextual Retrieval
│   ├── requirements.txt  # 의존성
│   └── .venv/            # Python 가상환경 (gitignored)
└── ...
```
