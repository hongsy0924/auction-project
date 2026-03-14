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
 */
export function reverseMatchHotZones(
    hotZones: HotZone[],
    auctionItems: { doc_id: string; dong: string; pnu: string }[],
): ReverseMatchAlert[] {
    const alerts: ReverseMatchAlert[] = [];

    for (const zone of hotZones) {
        const matchedDocIds: string[] = [];

        for (const item of auctionItems) {
            // Match by dong name
            const itemDong = item.dong || "";
            if (zone.dongNames.some((d) => itemDong.includes(d) || d.includes(itemDong))) {
                matchedDocIds.push(item.doc_id);
                continue;
            }

            // Match by area code (PNU first 5 digits)
            if (item.pnu && item.pnu.length >= 5 && item.pnu.substring(0, 5) === zone.areaCd) {
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
