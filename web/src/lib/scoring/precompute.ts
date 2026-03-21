import { calculateScore } from "./engine";
import type { ScoringInput } from "./engine";

export function buildScoringInput(item: Record<string, unknown>, gosiStage: number): ScoringInput {
    return {
        facilityInclude: String(item["포함"] || ""),
        facilityConflict: String(item["저촉"] || ""),
        facilityAdjoin: String(item["접합"] || ""),
        facilityAgeYears: parseFloat(String(item["시설경과연수"] || "0")) || undefined,
        gosiStage,
        yuchalCount: parseInt(String(item["유찰회수"] || "0"), 10) || 0,
    };
}

export function scoreItem(item: Record<string, unknown>, gosiStage: number) {
    const input = buildScoringInput(item, gosiStage);
    return calculateScore(input);
}
