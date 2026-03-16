import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringInput } from "../engine";
import { buildScoringInput } from "../precompute";

describe("calculateScore", () => {
    it("returns 0 for completely empty input", () => {
        const result = calculateScore({});
        expect(result.total).toBe(0);
    });

    it("scores facility_coverage: 포함 = 1.0 raw", () => {
        const result = calculateScore({ facilityInclude: "도로" });
        expect(result.components.facility_coverage.raw).toBe(1.0);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.2); // 1.0 * 0.20
    });

    it("scores facility_coverage: 저촉 = 0.7 raw", () => {
        const result = calculateScore({ facilityConflict: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.7);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.14);
    });

    it("scores facility_coverage: 접합 = 0.3 raw", () => {
        const result = calculateScore({ facilityAdjoin: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.3);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.06);
    });

    it("takes max when multiple coverage types exist", () => {
        const result = calculateScore({
            facilityInclude: "공원",
            facilityConflict: "도로",
        });
        // 포함 (1.0) > 저촉 (0.7) → takes 1.0
        expect(result.components.facility_coverage.raw).toBe(1.0);
    });

    it("ignores whitespace-only facility strings", () => {
        const result = calculateScore({ facilityInclude: "   " });
        expect(result.components.facility_coverage.raw).toBe(0);
    });

    it("scores facility_age tiers correctly", () => {
        // 18+ years = 1.0
        expect(calculateScore({ facilityAgeYears: 20 }).components.facility_age.raw).toBe(1.0);
        // 15-17 years = 0.8
        expect(calculateScore({ facilityAgeYears: 16 }).components.facility_age.raw).toBe(0.8);
        // 10-14 years = 0.5
        expect(calculateScore({ facilityAgeYears: 12 }).components.facility_age.raw).toBe(0.5);
        // 5-9 years = 0.2
        expect(calculateScore({ facilityAgeYears: 7 }).components.facility_age.raw).toBe(0.2);
        // 0-4 years = 0.1
        expect(calculateScore({ facilityAgeYears: 3 }).components.facility_age.raw).toBe(0.1);
    });

    it("scores facility_age: null/0/negative → 0", () => {
        expect(calculateScore({ facilityAgeYears: null }).components.facility_age.raw).toBe(0);
        expect(calculateScore({ facilityAgeYears: 0 }).components.facility_age.raw).toBe(0);
        expect(calculateScore({ facilityAgeYears: -5 }).components.facility_age.raw).toBe(0);
    });

    it("scores gosi_stage 0-4", () => {
        expect(calculateScore({ gosiStage: 0 }).components.gosi_stage.raw).toBe(0.0);
        expect(calculateScore({ gosiStage: 1 }).components.gosi_stage.raw).toBe(0.3);
        expect(calculateScore({ gosiStage: 2 }).components.gosi_stage.raw).toBe(0.5);
        expect(calculateScore({ gosiStage: 3 }).components.gosi_stage.raw).toBe(0.8);
        expect(calculateScore({ gosiStage: 4 }).components.gosi_stage.raw).toBe(1.0);
    });

    it("scores price_attractiveness tiers", () => {
        // ratio ≤ 0.5 = 1.0
        expect(calculateScore({ minToOfficialRatio: 0.3 }).components.price_attractiveness.raw).toBe(1.0);
        // ratio ≤ 0.7 = 0.7
        expect(calculateScore({ minToOfficialRatio: 0.6 }).components.price_attractiveness.raw).toBe(0.7);
        // ratio ≤ 0.9 = 0.4
        expect(calculateScore({ minToOfficialRatio: 0.85 }).components.price_attractiveness.raw).toBe(0.4);
        // ratio ≤ 1.2 = 0.1
        expect(calculateScore({ minToOfficialRatio: 1.1 }).components.price_attractiveness.raw).toBe(0.1);
        // ratio > 1.2 = 0
        expect(calculateScore({ minToOfficialRatio: 1.5 }).components.price_attractiveness.raw).toBe(0);
    });

    it("scores price_attractiveness: null/0 → 0", () => {
        expect(calculateScore({ minToOfficialRatio: null }).components.price_attractiveness.raw).toBe(0);
        expect(calculateScore({ minToOfficialRatio: 0 }).components.price_attractiveness.raw).toBe(0);
    });

    it("scores timing: yuchalCount capped at 0.6", () => {
        expect(calculateScore({ yuchalCount: 1 }).components.timing.raw).toBeCloseTo(0.15);
        expect(calculateScore({ yuchalCount: 3 }).components.timing.raw).toBeCloseTo(0.45);
        expect(calculateScore({ yuchalCount: 5 }).components.timing.raw).toBeCloseTo(0.6); // capped
        expect(calculateScore({ yuchalCount: 10 }).components.timing.raw).toBeCloseTo(0.6); // still capped
    });

    it("composite score sums weighted components", () => {
        const input: ScoringInput = {
            facilityInclude: "도로",      // raw=1.0, weighted=0.20
            facilityAgeYears: 20,         // raw=1.0, weighted=0.10
            gosiStage: 4,                 // raw=1.0, weighted=0.30
            minToOfficialRatio: 0.3,      // raw=1.0, weighted=0.25
            yuchalCount: 5,               // raw=0.6, weighted=0.09
        };
        const result = calculateScore(input);
        // 0.20 + 0.10 + 0.30 + 0.25 + 0.09 = 0.94
        expect(result.total).toBeCloseTo(0.94, 2);
    });

    it("total is rounded to 3 decimal places", () => {
        const result = calculateScore({ facilityConflict: "도로", yuchalCount: 1 });
        // 0.7*0.20 + 0.15*0.15 = 0.14 + 0.0225 = 0.1625 → rounds to 0.163
        const totalStr = result.total.toString();
        const decimals = totalStr.split(".")[1] || "";
        expect(decimals.length).toBeLessThanOrEqual(3);
    });
});

describe("buildScoringInput", () => {
    it("extracts scoring fields from auction item", () => {
        const item = {
            "포함": "도로",
            "저촉": "",
            "접합": "",
            "시설경과연수": "15.5",
            "최저가/공시지가비율": "0.45",
            "유찰회수": "3",
        };
        const input = buildScoringInput(item, 2);
        expect(input.facilityInclude).toBe("도로");
        expect(input.facilityAgeYears).toBeCloseTo(15.5);
        expect(input.minToOfficialRatio).toBeCloseTo(0.45);
        expect(input.yuchalCount).toBe(3);
        expect(input.gosiStage).toBe(2);
    });

    it("handles missing/zero values gracefully", () => {
        const item = {};
        const input = buildScoringInput(item, 0);
        expect(input.facilityInclude).toBe("");
        expect(input.facilityAgeYears).toBeUndefined();
        expect(input.minToOfficialRatio).toBeUndefined();
        expect(input.yuchalCount).toBe(0);
    });
});
