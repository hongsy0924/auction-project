/**
 * 토지이음 (eum.go.kr) 표준연계모듈 API client.
 *
 * Endpoints:
 *   - arMapList:      고시정보 (notices) — XML
 *   - arLandUseInfo:  토지이용규제 행위제한정보 — XML
 *   - isDevList:      개발 인허가 목록 조회 — JSON
 *
 * Auth: When EUM_PROXY_URL is set, requests go through the NCP proxy
 * which injects EUM credentials server-side. Otherwise, id + key query
 * parameters are sent directly to eum.go.kr (requires IP whitelisting).
 */
import { getXmlTag, getXmlTagAll } from "../xml-utils";
import {
    getCachedEumNotices,
    setCachedEumNotices,
    getCachedEumPermits,
    setCachedEumPermits,
    getCachedEumRestrictions,
    setCachedEumRestrictions,
    type CachedEumNotice,
    type CachedEumPermit,
    type CachedEumRestriction,
} from "../minutes/cache";

const EUM_BASE_URL = process.env.EUM_PROXY_URL || "https://api.eum.go.kr/web/Rest/OP";
const IS_PROXIED = !!process.env.EUM_PROXY_URL;

if (IS_PROXIED && !process.env.EUM_PROXY_KEY) {
    console.warn("[EUM] EUM_PROXY_URL is set but EUM_PROXY_KEY is missing — proxy will reject requests with 403");
}

function getAuthParams(): URLSearchParams | null {
    if (IS_PROXIED) {
        return new URLSearchParams();
    }
    const id = process.env.EUM_API_ID;
    const key = process.env.EUM_API_KEY;
    if (!id || !key) return null;
    return new URLSearchParams({ id, key });
}

function getProxyHeaders(): Record<string, string> {
    const proxyKey = process.env.EUM_PROXY_KEY;
    if (proxyKey) {
        return { "X-Proxy-Key": proxyKey };
    }
    return {};
}

// ─── 3.6 고시정보 (Notices) ─────────────────────────────────────────

export interface EumNotice {
    title: string;
    author: string;
    noticeDate: string;
    link: string;
    summary: string;
    areaCd: string;
}

/**
 * Fetch government notices for a 시군구 area code.
 * Queries last 24 months by default. Caches per areaCd (7-day TTL).
 */
export async function getEumNotices(areaCd: string): Promise<CachedEumNotice[]> {
    if (!areaCd || areaCd.length < 5) return [];

    const cached = await getCachedEumNotices(areaCd);
    if (cached) {
        console.log(`[EUM] Notices cache hit for ${areaCd}`);
        return cached;
    }

    const auth = getAuthParams();
    if (!auth) {
        console.warn("[EUM] EUM_API_ID/EUM_API_KEY not set, skipping notices");
        return [];
    }

    // Query last 24 months
    const endDt = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 24);
    const startDt = startDate.toISOString().slice(0, 10).replace(/-/g, "");

    const allNotices: EumNotice[] = [];
    let pageNo = 1;
    let totalPage = 1;

    try {
        while (pageNo <= totalPage && pageNo <= 10) { // cap at 10 pages (100 notices)
            const params = new URLSearchParams(auth);
            params.set("areaCd", areaCd);
            params.set("startDt", startDt);
            params.set("endDt", endDt);
            params.set("PageNo", String(pageNo));

            const response = await fetch(
                `${EUM_BASE_URL}/arMapList?${params}`,
                { signal: AbortSignal.timeout(15000), headers: getProxyHeaders() }
            );

            if (!response.ok) {
                console.error(`[EUM] Notices HTTP ${response.status} for ${areaCd}`);
                break;
            }

            const buffer = await response.arrayBuffer();
            const text = new TextDecoder("euc-kr").decode(buffer);

            // Check for error response
            const errorCode = getXmlTag(text, "ERROR_CODE");
            if (errorCode) {
                console.error(`[EUM] Notices error ${errorCode}: ${getXmlTag(text, "ERROR_MSG")} for ${areaCd}`);
                break;
            }

            if (pageNo === 1) {
                const tp = parseInt(getXmlTag(text, "totalPage"), 10);
                if (tp > 0) totalPage = tp;
                if (pageNo === 1 && allNotices.length === 0) {
                    console.log(`[EUM] Notices for ${areaCd}: totalSize=${getXmlTag(text, "totalSize")}, pages=${totalPage}`);
                }
            }

            const items = getXmlTagAll(text, "ArMap");
            for (const item of items) {
                allNotices.push({
                    title: getXmlTag(item, "TITLE"),
                    author: getXmlTag(item, "AUTHOR"),
                    noticeDate: getXmlTag(item, "NTC_DATE"),
                    link: getXmlTag(item, "LINK"),
                    summary: getXmlTag(item, "SUMMARY"),
                    areaCd,
                });
            }

            if (items.length === 0) break;
            pageNo++;
        }
    } catch (err) {
        console.error(`[EUM] Notices fetch error for ${areaCd}:`, err);
    }

    const cacheable: CachedEumNotice[] = allNotices.map((n) => ({
        title: n.title,
        noticeType: extractNoticeType(n.title),
        noticeDate: n.noticeDate,
        areaCd: n.areaCd,
        relatedAddress: n.summary?.slice(0, 200),
    }));
    setCachedEumNotices(areaCd, cacheable).catch(() => {});

    console.log(`[EUM] Cached ${cacheable.length} notices for ${areaCd}`);
    return cacheable;
}

/** Extract notice type from title keywords */
function extractNoticeType(title: string): string {
    if (title.includes("보상") || title.includes("수용")) return "보상";
    if (title.includes("도시계획")) return "도시계획";
    if (title.includes("택지")) return "택지개발";
    if (title.includes("도로")) return "도로";
    if (title.includes("산업단지") || title.includes("산업")) return "산업단지";
    if (title.includes("실시계획")) return "실시계획";
    if (title.includes("지구지정") || title.includes("지구 지정")) return "지구지정";
    if (title.includes("정비")) return "정비사업";
    return "기타고시";
}

// ─── Gosi Stage Classification ──────────────────────────────────────

/** Classify a government notice title into a project progression stage (0-4). */
export function classifyGosiStage(title: string): number {
    if (!title) return 0;
    // Stage 4: 보상/수용 확정 단계
    if (/보상계획|보상협의|수용재결|토지보상|보상공고/.test(title)) return 4;
    // Stage 3: 사업인정
    if (/사업인정|사업시행/.test(title)) return 3;
    // Stage 2: 실시계획
    if (/실시계획|실시계획인가/.test(title)) return 2;
    // Stage 1: 결정/지정 단계
    if (/결정고시|변경고시|지형도면|도시계획결정|지구지정|지구 지정|도시관리계획/.test(title)) return 1;
    return 0;
}

/** Keywords that indicate investment-relevant gosi notices. */
const GOSI_RELEVANCE_KEYWORDS = [
    "도시계획", "결정고시", "변경고시", "실시계획", "사업인정",
    "보상계획", "보상협의", "수용재결", "토지보상", "보상공고",
    "지구지정", "지형도면", "도시관리계획", "택지개발", "산업단지",
    "정비사업", "재개발", "재건축", "도로", "공원",
];

/** Filter notices that are relevant to urban planning / compensation. */
export function filterRelevantGosi(notices: CachedEumNotice[]): CachedEumNotice[] {
    return notices.filter((n) =>
        GOSI_RELEVANCE_KEYWORDS.some((kw) => n.title?.includes(kw))
    );
}

/** Match notices to a specific dong name via title/summary text matching. */
export function matchGosiToDong(
    notices: CachedEumNotice[],
    dongName: string,
): { notice: CachedEumNotice; gosiStage: number; matchType: "title" | "address" }[] {
    if (!dongName) return [];
    const matches: { notice: CachedEumNotice; gosiStage: number; matchType: "title" | "address" }[] = [];
    for (const n of notices) {
        const stage = classifyGosiStage(n.title);
        if (n.title?.includes(dongName)) {
            matches.push({ notice: n, gosiStage: stage, matchType: "title" });
        } else if (n.relatedAddress?.includes(dongName)) {
            matches.push({ notice: n, gosiStage: stage, matchType: "address" });
        }
    }
    return matches;
}

// ─── Hot Zone Extraction ────────────────────────────────────────────

export interface HotZone {
    areaCd: string;
    dongNames: string[];
    gosiTitle: string;
    gosiStage: number;
    ntcDate: string;
}

/** Extract "hot zones" from stage 3-4 notices (areas with active compensation). */
export function extractHotZones(notices: CachedEumNotice[]): HotZone[] {
    const hotZones: HotZone[] = [];
    for (const n of notices) {
        const stage = classifyGosiStage(n.title);
        if (stage < 3) continue;

        // Extract dong names from title and summary
        const dongNames = new Set<string>();
        const dongPattern = /([가-힣]+[동리읍면])\b/g;
        let match: RegExpExecArray | null;

        const searchText = `${n.title || ""} ${n.relatedAddress || ""}`;
        while ((match = dongPattern.exec(searchText)) !== null) {
            const name = match[1];
            // Filter out common false positives
            if (!["변경고시동", "사업인정동", "보상계획동"].includes(name)) {
                dongNames.add(name);
            }
        }

        if (dongNames.size > 0) {
            hotZones.push({
                areaCd: n.areaCd,
                dongNames: [...dongNames],
                gosiTitle: n.title,
                gosiStage: stage,
                ntcDate: n.noticeDate,
            });
        }
    }
    return hotZones;
}

// ─── 3.8 개발 인허가 목록 조회 (Dev Permits) ─────────────────────────

export interface EumDevPermit {
    pnu: string;
    locationName: string;
    landCategory: string;
    area: string;
    zoneType: string;
    districtType: string;
    devActionName: string;
    devActionPurpose: string;
    permitDate: string;
    requestDate: string;
    areaCd: string;
}

/**
 * Fetch dev permits for a 시군구 area code.
 * Queries last 12 months. Caches per areaCd (7-day TTL).
 * Response is JSON (unique among EUM endpoints).
 */
export async function getEumDevPermits(areaCd: string): Promise<CachedEumPermit[]> {
    if (!areaCd || areaCd.length < 5) return [];

    const cached = await getCachedEumPermits(areaCd);
    if (cached) {
        console.log(`[EUM] Permits cache hit for ${areaCd}`);
        return cached;
    }

    const auth = getAuthParams();
    if (!auth) {
        console.warn("[EUM] EUM_API_ID/EUM_API_KEY not set, skipping permits");
        return [];
    }

    // Query last 12 months
    const now = new Date();
    const endDate = now.toISOString().slice(0, 10).replace(/-/g, "");
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 12);
    const prmisnDe = startDate.toISOString().slice(0, 10).replace(/-/g, "");

    const allPermits: EumDevPermit[] = [];
    let pageNo = 1;
    let totalPage = 1;

    try {
        while (pageNo <= totalPage && pageNo <= 5) { // cap at 5 pages (150 permits)
            const params = new URLSearchParams(auth);
            params.set("areaCd", areaCd);
            params.set("prmisnDe", prmisnDe);
            params.set("PageNo", String(pageNo));

            const response = await fetch(
                `${EUM_BASE_URL}/isDevList?${params}`,
                { signal: AbortSignal.timeout(15000), headers: getProxyHeaders() }
            );

            if (!response.ok) {
                console.error(`[EUM] Permits HTTP ${response.status} for ${areaCd}`);
                break;
            }

            const data = await response.json();

            // Check for error
            if (data.ERROR_CODE) {
                console.error(`[EUM] Permits error ${data.ERROR_CODE}: ${data.ERROR_MSG} for ${areaCd}`);
                break;
            }

            if (pageNo === 1) {
                totalPage = data.totalPage || 1;
                console.log(`[EUM] Permits for ${areaCd}: cnt=${data.cnt}, pages=${totalPage}`);
            }

            const list = data.list || [];
            for (const item of list) {
                allPermits.push({
                    pnu: item.pnu || "",
                    locationName: item.lcNm || "",
                    landCategory: item.lndcgrNm || "",
                    area: item.ar ? String(item.ar) : "",
                    zoneType: item.spfcCdNm || "",
                    districtType: item.spcfcCdNm || "",
                    devActionName: item.seCdNm || "",
                    devActionPurpose: item.devlopActionPurps || "",
                    permitDate: item.prmisnDe || "",
                    requestDate: item.reqstDe || "",
                    areaCd,
                });
            }

            if (list.length === 0) break;
            pageNo++;
        }
    } catch (err) {
        console.error(`[EUM] Permits fetch error for ${areaCd}:`, err);
    }

    const cacheable: CachedEumPermit[] = allPermits.map((p) => ({
        projectName: `${p.devActionName} — ${p.devActionPurpose}`.trim(),
        permitType: p.devActionName,
        permitDate: p.permitDate,
        areaCd: p.areaCd,
        area: p.area,
    }));
    setCachedEumPermits(areaCd, cacheable).catch(() => {});

    console.log(`[EUM] Cached ${cacheable.length} permits for ${areaCd}`);
    return cacheable;
}

// ─── 3.5 토지이용규제 행위제한정보 (Restrictions) ─────────────────────

export interface EumRestriction {
    zoneName: string;
    zoneCode: string;
    activityName: string;
    allowed: string;
    areaCd: string;
}

/** Investment-relevant zone codes to check */
const INVESTMENT_ZONE_CODES = [
    "UQA110", "UQA120", "UQA130", "UQA140", "UQA150", // 주거지역
    "UQA200", // 일반상업
    "UQA300", // 일반공업
    "UQA430", // 자연녹지
];

/**
 * Fetch land use restriction info for a 시군구 area code.
 * Checks investment-relevant zones. Caches per areaCd (30-day TTL).
 */
export async function getEumRestrictions(areaCd: string): Promise<CachedEumRestriction[]> {
    if (!areaCd || areaCd.length < 5) return [];

    const cached = await getCachedEumRestrictions(areaCd);
    if (cached) {
        console.log(`[EUM] Restrictions cache hit for ${areaCd}`);
        return cached;
    }

    const auth = getAuthParams();
    if (!auth) {
        console.warn("[EUM] EUM_API_ID/EUM_API_KEY not set, skipping restrictions");
        return [];
    }

    const allRestrictions: EumRestriction[] = [];

    try {
        const params = new URLSearchParams(auth);
        params.set("areaCd", areaCd);
        params.set("ucodeList", INVESTMENT_ZONE_CODES.join(","));
        params.set("landUseNm", "건축");

        const response = await fetch(
            `${EUM_BASE_URL}/arLandUseInfo?${params}`,
            { signal: AbortSignal.timeout(15000), headers: getProxyHeaders() }
        );

        if (!response.ok) {
            console.error(`[EUM] Restrictions HTTP ${response.status} for ${areaCd}`);
            return [];
        }

        const buffer = await response.arrayBuffer();
        const text = new TextDecoder("euc-kr").decode(buffer);

        const errorCode = getXmlTag(text, "ERROR_CODE");
        if (errorCode) {
            console.error(`[EUM] Restrictions error ${errorCode}: ${getXmlTag(text, "ERROR_MSG")} for ${areaCd}`);
            return [];
        }

        const items = getXmlTagAll(text, "ActReg");
        for (const item of items) {
            const zoneName = getXmlTag(item, "UNAME");
            const zoneCode = getXmlTag(item, "UCODE");

            const actRegBlocks = getXmlTagAll(item, "actRegList");
            for (const block of actRegBlocks) {
                const actName = getXmlTag(block, "ACT_NM");
                const regName = getXmlTag(block, "REG_NM");
                if (!actName) continue;

                allRestrictions.push({
                    zoneName,
                    zoneCode,
                    activityName: actName,
                    allowed: regName,
                    areaCd,
                });
            }
        }

        console.log(`[EUM] Restrictions for ${areaCd}: ${allRestrictions.length} entries`);
    } catch (err) {
        console.error(`[EUM] Restrictions fetch error for ${areaCd}:`, err);
    }

    const cacheable: CachedEumRestriction[] = allRestrictions.map((r) => ({
        zoneName: r.zoneName,
        restrictionType: r.allowed,
        description: `${r.zoneName} — ${r.activityName}: ${r.allowed}`,
        areaCd: r.areaCd,
    }));
    setCachedEumRestrictions(areaCd, cacheable).catch(() => {});

    return cacheable;
}
