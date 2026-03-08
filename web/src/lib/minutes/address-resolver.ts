import { COUNCILS } from "./councils";

/**
 * 정식 시도명 → 약칭 변환 맵
 */
const SIDO_ALIAS: Record<string, string> = {
    "서울특별시": "서울",
    "부산광역시": "부산",
    "대구광역시": "대구",
    "인천광역시": "인천",
    "광주광역시": "광주",
    "대전광역시": "대전",
    "울산광역시": "울산",
    "세종특별자치시": "세종",
    "경기도": "경기",
    "강원도": "강원",
    "강원특별자치도": "강원",
    "충청북도": "충북",
    "충청남도": "충남",
    "전라북도": "전북",
    "전북특별자치도": "전북",
    "전라남도": "전남",
    "경상북도": "경북",
    "경상남도": "경남",
    "제주특별자치도": "제주",
    "제주도": "제주",
};

export interface ResolvedLocation {
    sido: string;
    sigungu: string;
    dong?: string;
    councilCodes: { name: string; code: string }[];
}

/**
 * 주소 문자열을 파싱하여 관할 의회코드를 반환.
 * 시군구 의회 + 상위 도/광역시 의회 양쪽을 반환.
 *
 * @example
 * resolveAddressToCouncils("충청남도 서산시 성연면 일람리 100")
 * // → { sido: "충남", sigungu: "서산시", dong: "성연면",
 * //     councilCodes: [{ name: "충남 서산시", code: "041009" }, { name: "충남", code: "041001" }] }
 */
export function resolveAddressToCouncils(address: string): ResolvedLocation | null {
    if (!address || !address.trim()) return null;

    // "소재지 :" 접두사 제거
    const cleaned = address.replace(/^소재지\s*:\s*/i, "").trim();

    // 주소를 공백으로 분할
    const parts = cleaned.split(/\s+/);
    if (parts.length < 2) return null;

    // 1. 시도 추출 및 약칭 변환
    let sido = parts[0];
    if (SIDO_ALIAS[sido]) {
        sido = SIDO_ALIAS[sido];
    }

    // 2. 시군구 추출
    let sigungu = "";
    let dongStartIdx = 2;

    // 세종시 특수 처리 (시군구 없이 바로 동 단위)
    if (sido === "세종") {
        sigungu = "";
        dongStartIdx = 1;
    } else {
        sigungu = parts[1] || "";
        dongStartIdx = 2;
    }

    // 3. 동/읍/면 추출
    let dong: string | undefined;
    if (parts.length > dongStartIdx) {
        const dongCandidate = parts[dongStartIdx];
        if (dongCandidate.endsWith("동") || dongCandidate.endsWith("면") ||
            dongCandidate.endsWith("읍") || dongCandidate.endsWith("리") ||
            dongCandidate.endsWith("가")) {
            dong = dongCandidate;
        }
    }

    // 3b. 도로명주소 괄호 안에서 동/읍/면 추출
    // 예: "서울특별시 동작구 매봉로4가길 45 (상도동,제이-레지던스)" → "상도동"
    if (!dong) {
        const parenMatch = cleaned.match(/\(([^)]+)\)/);
        if (parenMatch) {
            const inside = parenMatch[1].split(/[,\s]+/);
            for (const token of inside) {
                const t = token.trim();
                if (t.endsWith("동") || t.endsWith("면") || t.endsWith("읍") || t.endsWith("리")) {
                    dong = t;
                    break;
                }
            }
        }
    }

    // 4. 의회코드 매핑
    const councilCodes: { name: string; code: string }[] = [];

    // 시군구 의회 조회 (예: "충남 서산시")
    if (sigungu) {
        const sigunguKey = `${sido} ${sigungu}`;
        if (COUNCILS[sigunguKey]) {
            councilCodes.push({ name: sigunguKey, code: COUNCILS[sigunguKey] });
        } else {
            // "시" 접미사 제거 후 재시도 (예: "서산" → "충남 서산시" 는 이미 맞지만 안전장치)
            const stripped = sigungu.replace(/(시|군|구)$/, "");
            for (const [name, code] of Object.entries(COUNCILS)) {
                if (name.startsWith(`${sido} `) && name.includes(stripped)) {
                    councilCodes.push({ name, code });
                    break;
                }
            }
        }
    }

    // 상위 도/광역시 의회 조회 (예: "충남")
    if (COUNCILS[sido]) {
        councilCodes.push({ name: sido, code: COUNCILS[sido] });
    }

    if (councilCodes.length === 0) return null;

    return { sido, sigungu, dong, councilCodes };
}

/**
 * AuctionItem의 구조화된 행정코드 필드에서 직접 의회코드 매핑.
 * DB에 시도/시군구/동 컬럼이 있는 경우 주소 파싱 없이 사용.
 */
export function resolveFromStructured(
    sido?: string,
    sigungu?: string,
    dong?: string,
): ResolvedLocation | null {
    if (!sido) return null;

    // 시도명 약칭 변환
    const sidoShort = SIDO_ALIAS[sido] || sido;

    const councilCodes: { name: string; code: string }[] = [];

    // 시군구 의회
    if (sigungu) {
        const sigunguKey = `${sidoShort} ${sigungu}`;
        if (COUNCILS[sigunguKey]) {
            councilCodes.push({ name: sigunguKey, code: COUNCILS[sigunguKey] });
        }
    }

    // 도/광역시 의회
    if (COUNCILS[sidoShort]) {
        councilCodes.push({ name: sidoShort, code: COUNCILS[sidoShort] });
    }

    if (councilCodes.length === 0) return null;

    return { sido: sidoShort, sigungu: sigungu || "", dong, councilCodes };
}
