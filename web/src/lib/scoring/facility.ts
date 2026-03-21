/**
 * Shared facility classification logic.
 * Used by both the scoring engine and the query layer.
 *
 * 포함/저촉 columns from VWorld contain ALL land-use attributes, not just
 * 도시계획시설. This module identifies which terms are actual facilities
 * relevant for compensation (도로, 공원, 하천, etc.) vs generic zoning
 * designations (용도지역, 대공방어협조구역, etc.).
 */

/** Maps regex patterns to human-readable facility categories. */
export const FACILITY_CATEGORY_RULES: [RegExp, string][] = [
    [/소로/, "도로(소로)"],
    [/중로/, "도로(중로)"],
    [/대로/, "도로(대로)"],
    [/^도로구역$|^도로$/, "도로"],
    [/근린공원|도시자연공원|소공원|어린이공원|체육공원|묘지공원|문화공원|수변공원|역사공원/, "공원"],
    [/완충녹지|경관녹지|연결녹지|보전녹지지역/, "녹지"],
    [/하천구역|^하천$|소하천구역|소하천예정지|^소하천$/, "하천"],
    [/주차장/, "주차장"],
    [/학교|교육/, "학교/교육"],
    [/문화시설/, "문화시설"],
    [/철도보호지구|철도/, "철도"],
    [/유수지|저수지/, "유수지"],
    [/시장/, "시장"],
    [/광장/, "광장"],
    [/하수처리/, "하수시설"],
    [/폐기물매립시설/, "폐기물시설"],
];

/** Reverse mapping: category name → SQL LIKE keyword for filtering. */
export const FACILITY_CATEGORY_KEYWORDS: Record<string, string> = {
    "도로(소로)": "소로",
    "도로(중로)": "중로",
    "도로(대로)": "대로",
    "도로": "도로",
    "공원": "공원",
    "녹지": "녹지",
    "하천": "하천",
    "주차장": "주차장",
    "학교/교육": "교육",
    "문화시설": "문화시설",
    "철도": "철도",
    "유수지": "유수지",
    "시장": "시장",
    "광장": "광장",
    "하수시설": "하수처리",
    "폐기물시설": "폐기물매립시설",
};

/** Classify a single land-use term into a facility category, or null if not a facility. */
export function classifyFacilityTerm(term: string): string | null {
    const cleaned = term.replace(/\([^)]*\)/g, "").trim();
    for (const [pattern, category] of FACILITY_CATEGORY_RULES) {
        if (pattern.test(cleaned)) return category;
    }
    return null;
}

/**
 * Check if a comma-separated land-use string contains any actual facility terms.
 * Returns true if at least one term matches a facility category.
 */
export function containsFacilityTerms(landUseText: string | null | undefined): boolean {
    if (!landUseText || !landUseText.trim()) return false;
    const terms = landUseText.split(",").map((s) => s.trim()).filter(Boolean);
    return terms.some((term) => classifyFacilityTerm(term) !== null);
}
