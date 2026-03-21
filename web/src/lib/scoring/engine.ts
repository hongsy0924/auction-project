/**
 * Weighted scoring engine for auction property investment analysis.
 * Replaces the old 200-point proxy scoring with a 0-1.0 data-driven score.
 */
import { SCORING_CONFIG, type ScoreComponent } from "./config";

export interface ScoreBreakdown {
    total: number;
    components: Record<ScoreComponent, { raw: number; weighted: number }>;
}

export interface ScoringInput {
    /** 포함/저촉/접합 text from DB — used to determine facility coverage */
    facilityInclude?: string | null;
    facilityConflict?: string | null;
    facilityAdjoin?: string | null;
    /** Facility age in years (from registDt) */
    facilityAgeYears?: number | null;
    /** Highest gosi stage for this property (0-4) */
    gosiStage?: number;
    /** 유찰 횟수 */
    yuchalCount?: number;
}

/** Calculate facility coverage score (0-1.0) from 포함/저촉/접합 data. */
function scoreFacilityCoverage(input: ScoringInput): number {
    const cfg = SCORING_CONFIG.facility_coverage;
    let maxScore = 0;
    if (input.facilityInclude && input.facilityInclude.trim()) {
        maxScore = Math.max(maxScore, cfg["포함"] ?? 0);
    }
    if (input.facilityConflict && input.facilityConflict.trim()) {
        maxScore = Math.max(maxScore, cfg["저촉"] ?? 0);
    }
    if (input.facilityAdjoin && input.facilityAdjoin.trim()) {
        maxScore = Math.max(maxScore, cfg["접합"] ?? 0);
    }
    return maxScore;
}

/** Calculate facility age score (0-1.0). */
function scoreFacilityAge(input: ScoringInput): number {
    const years = input.facilityAgeYears;
    if (years == null || years <= 0) return 0;
    for (const tier of SCORING_CONFIG.facility_age) {
        if (years >= tier.minYears) return tier.score;
    }
    return 0;
}

/** Calculate gosi stage score (0-1.0). */
function scoreGosiStage(input: ScoringInput): number {
    const stage = input.gosiStage ?? 0;
    return SCORING_CONFIG.gosi_stage[stage] ?? 0;
}

/** Calculate timing score (0-1.0) based on yuchal count. */
function scoreTiming(input: ScoringInput): number {
    const count = input.yuchalCount ?? 0;
    const cfg = SCORING_CONFIG.timing;
    return Math.min(count * cfg.yuchalBonusPerCount, cfg.yuchalMaxBonus);
}

/**
 * Calculate the composite investment score (0-1.0).
 * Returns total and per-component breakdown.
 */
export function calculateScore(input: ScoringInput): ScoreBreakdown {
    const weights = SCORING_CONFIG.weights;
    const fc = scoreFacilityCoverage(input);
    const fa = scoreFacilityAge(input);
    const gs = scoreGosiStage(input);
    const tm = scoreTiming(input);

    const total =
        fc * weights.facility_coverage +
        fa * weights.facility_age +
        gs * weights.gosi_stage +
        tm * weights.timing;

    return {
        total: Math.round(total * 1000) / 1000,
        components: {
            facility_coverage: { raw: fc, weighted: fc * weights.facility_coverage },
            facility_age: { raw: fa, weighted: fa * weights.facility_age },
            gosi_stage: { raw: gs, weighted: gs * weights.gosi_stage },
            timing: { raw: tm, weighted: tm * weights.timing },
        },
    };
}
