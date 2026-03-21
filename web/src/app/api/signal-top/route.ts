import { NextRequest } from "next/server";
import {
    getPropertyScores,
    getPropertyScoreCount,
    getPropertyAnalysisBatch,
    getHotZoneAlerts,
    getFacilityTypeCounts,
    type ScoreSortKey,
    type ScoreQueryOptions,
} from "@/lib/minutes/cache";

export const dynamic = "force-dynamic";

const VALID_SORTS = new Set<ScoreSortKey>(["score", "facility_age", "gosi_stage", "facility", "compensation"]);

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") || "20", 10)));
    const sortParam = searchParams.get("sort") || "score";
    const sort: ScoreSortKey = VALID_SORTS.has(sortParam as ScoreSortKey) ? (sortParam as ScoreSortKey) : "score";
    const filterCompensation = searchParams.get("filter_compensation") === "1";
    const excludeHousing = searchParams.get("exclude_housing") === "1";
    const filterFacility = searchParams.get("filter_facility") === "1";
    const facilityType = searchParams.get("facility_type") || undefined;
    const filterIncludeOnly = searchParams.get("filter_include_only") === "1";
    const filterUnexecutedOnly = searchParams.get("filter_unexecuted_only") === "1";

    // Cap total results (expanded when facility filter is active)
    const MAX_RESULTS = filterFacility ? 500 : 100;
    const offset = (page - 1) * perPage;

    if (offset >= MAX_RESULTS) {
        return Response.json({ data: [], total: MAX_RESULTS, page, perPage });
    }

    const adjustedLimit = Math.min(perPage, MAX_RESULTS - offset);
    const queryOpts: ScoreQueryOptions = {
        limit: adjustedLimit, offset, sort, filterCompensation, excludeHousing,
        filterFacility, facilityType, filterIncludeOnly, filterUnexecutedOnly,
    };

    try {
        const [items, rawTotal] = await Promise.all([
            getPropertyScores(queryOpts),
            getPropertyScoreCount(queryOpts),
        ]);

        const total = Math.min(rawTotal, MAX_RESULTS);

        const docIds = items.map((i) => i.doc_id);
        const analysisMap = await getPropertyAnalysisBatch(docIds);

        const data = items.map((item) => ({
            ...item,
            signal_keywords: item.signal_keywords ? JSON.parse(item.signal_keywords) : [],
            signal_details: item.signal_details ? JSON.parse(item.signal_details) : [],
            facility_details: item.facility_details ? JSON.parse(item.facility_details) : [],
            notice_details: item.notice_details ? JSON.parse(item.notice_details) : [],
            permit_details: item.permit_details ? JSON.parse(item.permit_details) : [],
            restriction_details: item.restriction_details ? JSON.parse(item.restriction_details) : [],
            auction_data: item.auction_data ? JSON.parse(item.auction_data) : {},
            has_analysis: analysisMap.has(item.doc_id),
        }));

        // Fetch hot zone alerts
        let hotZoneAlerts: import("@/lib/minutes/cache").CachedHotZoneAlert[] = [];
        try {
            hotZoneAlerts = await getHotZoneAlerts();
        } catch { /* non-critical */ }

        let facilityTypeCounts: { type: string; count: number }[] = [];
        if (filterFacility) {
            try {
                facilityTypeCounts = await getFacilityTypeCounts();
            } catch { /* non-critical */ }
        }

        return Response.json({ data, total, page, perPage, hotZoneAlerts, facilityTypeCounts });
    } catch (err) {
        console.error("[signal-top] Error:", err);
        return Response.json({ error: "Failed to fetch signal scores" }, { status: 500 });
    }
}
