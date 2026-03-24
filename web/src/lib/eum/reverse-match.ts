/**
 * Reverse matching: cross-reference EUM hot zones (stage 3-4 gosi areas)
 * with auction items to surface "compensation-zone auctions."
 */
import type { HotZone } from "./client";

export interface ReverseMatchAlert {
    zone: HotZone;
    matchedDocIds: string[];
    alertType: "reverse_match";
}

/**
 * Cross-reference hot zones with auction items.
 * Returns alerts for auction items that fall within active compensation zones.
 *
 * Matching tiers (most specific first):
 *   1. Dong/ri name match — item's dong contains a zone dongName or vice versa
 *   2. 읍면 (eup/myeon) match — same 읍면 code (PNU digits 6-8) within the same 시군구
 * The old 시군구-level fallback (PNU first 5 digits) was removed because it
 * matched every item in the county, producing noisy alerts.
 */
export function reverseMatchHotZones(
    hotZones: HotZone[],
    auctionItems: { doc_id: string; dong: string; pnu: string }[],
): ReverseMatchAlert[] {
    const alerts: ReverseMatchAlert[] = [];

    for (const zone of hotZones) {
        const matchedDocIds: string[] = [];

        // Build a set of 읍면 codes (PNU first 8 digits) from zone dongNames
        // by scanning auction items that match dongNames to learn their PNU prefixes.
        const zonEupMyeonCodes = new Set<string>();
        for (const item of auctionItems) {
            const itemDong = item.dong || "";
            if (item.pnu?.length >= 8 && zone.dongNames.some((d) => itemDong.includes(d) || d.includes(itemDong))) {
                zonEupMyeonCodes.add(item.pnu.substring(0, 8));
            }
        }

        for (const item of auctionItems) {
            // Tier 1: Dong/ri name match
            const itemDong = item.dong || "";
            if (zone.dongNames.some((d) => itemDong.includes(d) || d.includes(itemDong))) {
                matchedDocIds.push(item.doc_id);
                continue;
            }

            // Tier 2: Same 읍면 (eup/myeon) — PNU first 8 digits
            if (item.pnu?.length >= 8 && zonEupMyeonCodes.has(item.pnu.substring(0, 8))) {
                matchedDocIds.push(item.doc_id);
            }
        }

        if (matchedDocIds.length > 0) {
            alerts.push({
                zone,
                matchedDocIds,
                alertType: "reverse_match",
            });
        }
    }

    return alerts;
}
