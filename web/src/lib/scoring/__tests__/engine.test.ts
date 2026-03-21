import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringInput } from "../engine";
import { buildScoringInput } from "../precompute";

describe("calculateScore", () => {
    it("returns 0 for completely empty input", () => {
        const result = calculateScore({});
        expect(result.total).toBe(0);
    });

    it("scores facility_coverage: 포함 with real facility = 1.0 raw", () => {
        const result = calculateScore({ facilityInclude: "소로3류" });
        expect(result.components.facility_coverage.raw).toBe(1.0);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.4); // 1.0 * 0.40
    });

    it("scores facility_coverage: 저촉 with real facility = 0.7 raw", () => {
        const result = calculateScore({ facilityConflict: "도로" });
        expect(result.components.facility_coverage.raw).toBe(0.7);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.28);
    });

    it("scores facility_coverage: 접합 with real facility = 0.3 raw", () => {
        const result = calculateScore({ facilityAdjoin: "근린공원" });
        expect(result.components.facility_coverage.raw).toBe(0.3);
        expect(result.components.facility_coverage.weighted).toBeCloseTo(0.12);
    });

    it("takes max when multiple coverage types exist", () => {
        const result = calculateScore({
            facilityInclude: "근린공원",
            facilityConflict: "소로1류",
        });
        // 포함 (1.0) > 저촉 (0.7) → takes 1.0
        expect(result.components.facility_coverage.raw).toBe(1.0);
    });

    it("scores 0 for zoning-only data (no real facilities)", () => {
        const result = calculateScore({
            facilityInclude: "대공방어협조구역, 도시지역, 제2종일반주거지역",
        });
        expect(result.components.facility_coverage.raw).toBe(0);
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

    it("scores timing: yuchalCount capped at 0.6", () => {
        expect(calculateScore({ yuchalCount: 1 }).components.timing.raw).toBeCloseTo(0.15);
        expect(calculateScore({ yuchalCount: 3 }).components.timing.raw).toBeCloseTo(0.45);
        expect(calculateScore({ yuchalCount: 5 }).components.timing.raw).toBeCloseTo(0.6); // capped
        expect(calculateScore({ yuchalCount: 10 }).components.timing.raw).toBeCloseTo(0.6); // still capped
    });

    it("composite score sums weighted components", () => {
        const input: ScoringInput = {
            facilityInclude: "소로3류",    // raw=1.0, weighted=0.40
            facilityAgeYears: 20,         // raw=1.0, weighted=0.15
            gosiStage: 4,                 // raw=1.0, weighted=0.30
            yuchalCount: 5,               // raw=0.6, weighted=0.09
        };
        const result = calculateScore(input);
        // 0.40 + 0.15 + 0.30 + 0.09 = 0.94
        expect(result.total).toBeCloseTo(0.94, 2);
    });

    it("total is rounded to 3 decimal places", () => {
        const result = calculateScore({ facilityConflict: "도로", yuchalCount: 1 });
        // 0.7*0.40 + 0.15*0.15 = 0.28 + 0.0225 = 0.3025 → rounds to 0.303
        const totalStr = result.total.toString();
        const decimals = totalStr.split(".")[1] || "";
        expect(decimals.length).toBeLessThanOrEqual(3);
    });
});

describe("buildScoringInput", () => {
    it("extracts scoring fields from auction item", () => {
        const item = {
            "포함": "소로3류",
            "저촉": "",
            "접합": "",
            "시설경과연수": "15.5",
            "유찰회수": "3",
        };
        const input = buildScoringInput(item, 2);
        expect(input.facilityInclude).toBe("소로3류");
        expect(input.facilityAgeYears).toBeCloseTo(15.5);
        expect(input.yuchalCount).toBe(3);
        expect(input.gosiStage).toBe(2);
    });

    it("handles missing/zero values gracefully", () => {
        const item = {};
        const input = buildScoringInput(item, 0);
        expect(input.facilityInclude).toBe("");
        expect(input.facilityAgeYears).toBeUndefined();
        expect(input.yuchalCount).toBe(0);
    });
});
