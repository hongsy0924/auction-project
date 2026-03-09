/**
 * LURIS 토지이용정보서비스 (arLandUseInfoService) API client.
 *
 * Operations:
 *   - DTarLandUseInfo:  Check permitted/prohibited activities for a zone in an area
 *   - DTsearchLunCd:    Search land use activity codes by keyword
 *
 * API returns XML in EUC-KR encoding.
 */
import { getCachedLuris, setCachedLuris, type CachedLurisFacility } from "../minutes/cache";
import { getXmlTag, getXmlTagAll } from "../xml-utils";

const LURIS_BASE_URL = "https://apis.data.go.kr/1613000/arLandUseInfoService";

export interface UrbanPlanFacility {
    facilityName: string;
    facilityType: string;
    decisionDate?: string;
    executionStatus?: string;
}

/** Common zoning codes relevant to real estate investment */
const INVESTMENT_ZONES: { code: string; name: string }[] = [
    { code: "UQA110", name: "제1종전용주거지역" },
    { code: "UQA120", name: "제2종전용주거지역" },
    { code: "UQA130", name: "준주거지역" },
    { code: "UQA140", name: "제2종일반주거지역" },
    { code: "UQA150", name: "제3종일반주거지역" },
    { code: "UQA200", name: "일반상업지역" },
    { code: "UQA300", name: "일반공업지역" },
    { code: "UQA430", name: "자연녹지지역" },
];

/** Investment-relevant activities to check */
const INVESTMENT_ACTIVITIES = ["건축", "개발"];

/**
 * Fetch land use regulation info for a given PNU.
 * Extracts area code from PNU, then queries key zones + activities.
 * Returns cached results if available.
 */
export async function getUrbanPlanFacilities(pnu: string): Promise<UrbanPlanFacility[]> {
    if (!pnu || pnu.length < 10) return [];

    // Check cache first
    const cached = await getCachedLuris(pnu);
    if (cached) {
        console.log(`[LURIS] Cache hit for PNU ${pnu}`);
        return cached;
    }

    const apiKey = process.env.LURIS_API_KEY;
    if (!apiKey) {
        console.warn("[LURIS] LURIS_API_KEY not set, skipping regulation lookup");
        return [];
    }

    // Extract 시군구 area code from PNU (first 5 digits)
    const areaCd = pnu.substring(0, 5);

    try {
        const facilities: UrbanPlanFacility[] = [];

        // Query a subset of zones with investment activities (limit API calls)
        const zonesToCheck = INVESTMENT_ZONES.slice(0, 4);
        const promises = zonesToCheck.flatMap((zone) =>
            INVESTMENT_ACTIVITIES.map((activity) =>
                queryLandUseInfo(apiKey, areaCd, zone.code, activity)
            )
        );

        const results = await Promise.all(promises);
        for (const items of results) {
            facilities.push(...items);
        }

        // Deduplicate by facilityName + facilityType
        const seen = new Set<string>();
        const unique = facilities.filter((f) => {
            const key = `${f.facilityType}:${f.facilityName}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Cache the result
        const cacheable: CachedLurisFacility[] = unique.map((f) => ({
            facilityName: f.facilityName,
            facilityType: f.facilityType,
            decisionDate: f.decisionDate,
            executionStatus: f.executionStatus,
        }));
        setCachedLuris(pnu, cacheable).catch(() => {});

        console.log(`[LURIS] Found ${unique.length} regulation entries for PNU ${pnu} (area: ${areaCd})`);
        return unique;
    } catch (err) {
        console.error("[LURIS] Failed to fetch regulations:", err);
        return [];
    }
}

/**
 * DTarLandUseInfo: Check what activities are permitted/prohibited in a zone.
 */
async function queryLandUseInfo(
    apiKey: string,
    areaCd: string,
    ucodeList: string,
    landUseNm: string
): Promise<UrbanPlanFacility[]> {
    const params = new URLSearchParams({
        serviceKey: apiKey,
        areaCd,
        ucodeList,
        landUseNm,
        numOfRows: "20",
        pageNo: "1",
    });

    try {
        const response = await fetch(
            `${LURIS_BASE_URL}/DTarLandUseInfo?${params}`,
            { signal: AbortSignal.timeout(10000) }
        );

        if (!response.ok) return [];

        const buffer = await response.arrayBuffer();
        const xml = new TextDecoder("euc-kr").decode(buffer);
        return parseDTarLandUseInfoXml(xml);
    } catch {
        return [];
    }
}

/**
 * DTsearchLunCd: Search land use activity codes by keyword.
 * Useful for finding what activity codes relate to a concept.
 */
export async function searchLandUseCodes(
    keyword: string
): Promise<{ name: string; code: string }[]> {
    const apiKey = process.env.LURIS_API_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        serviceKey: apiKey,
        landUseNm: keyword,
        numOfRows: "20",
        pageNo: "1",
    });

    try {
        const response = await fetch(
            `${LURIS_BASE_URL}/DTsearchLunCd?${params}`,
            { signal: AbortSignal.timeout(10000) }
        );

        if (!response.ok) return [];

        const buffer = await response.arrayBuffer();
        const xml = new TextDecoder("euc-kr").decode(buffer);
        return parseDTsearchLunCdXml(xml);
    } catch {
        return [];
    }
}

// ─── XML Parsers ──────────────────────────────────────────────────────

function parseDTarLandUseInfoXml(xml: string): UrbanPlanFacility[] {
    const facilities: UrbanPlanFacility[] = [];

    const resultCode = getXmlTag(xml, "resultCode");
    if (resultCode !== "0") return [];

    const items = getXmlTagAll(xml, "item");
    for (const item of items) {
        const zoneName = getXmlTag(item, "UNAME");
        const lawRef = getXmlTag(item, "UCODE_REF_LAW_NM");

        // Parse actRegList blocks within this item
        const actRegBlocks = getXmlTagAll(item, "actRegList");
        for (const block of actRegBlocks) {
            const actName = getXmlTag(block, "ACT_NM");
            const regName = getXmlTag(block, "REG_NM"); // 가능 / 금지

            if (!actName) continue;

            facilities.push({
                facilityName: `${zoneName} — ${actName}`,
                facilityType: zoneName,
                decisionDate: lawRef || undefined,
                executionStatus: regName || undefined,
            });
        }

        // If no actRegList but we have zone info
        if (actRegBlocks.length === 0 && zoneName) {
            facilities.push({
                facilityName: zoneName,
                facilityType: zoneName,
                decisionDate: lawRef || undefined,
            });
        }
    }

    return facilities;
}

function parseDTsearchLunCdXml(xml: string): { name: string; code: string }[] {
    const results: { name: string; code: string }[] = [];

    const resultCode = getXmlTag(xml, "resultCode");
    if (resultCode !== "0") return [];

    const items = getXmlTagAll(xml, "item");
    for (const item of items) {
        const name = getXmlTag(item, "LUN_NM");
        const code = getXmlTag(item, "LUN_CD");
        if (name && code) {
            results.push({ name, code });
        }
    }

    return results;
}
