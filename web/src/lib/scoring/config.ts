/**
 * Scoring configuration for auction property investment analysis.
 * Score is 0-1.0 weighted across 4 factors.
 */

export const SCORING_CONFIG = {
    weights: {
        facility_coverage: 0.40,   // 도시계획시설 저촉 정도 (primary signal)
        facility_age: 0.15,        // 시설결정 경과연수
        gosi_stage: 0.30,          // 사업 진행도
        timing: 0.15,              // 엑싯 타이밍 (유찰)
    },
    facility_coverage: { "포함": 1.0, "저촉": 0.7, "접합": 0.3 } as Record<string, number>,
    facility_age: [
        { minYears: 18, score: 1.0 },
        { minYears: 15, score: 0.8 },
        { minYears: 10, score: 0.5 },
        { minYears: 5, score: 0.2 },
        { minYears: 0, score: 0.1 },
    ],
    gosi_stage: { 0: 0.0, 1: 0.3, 2: 0.5, 3: 0.8, 4: 1.0 } as Record<number, number>,
    timing: { yuchalBonusPerCount: 0.15, yuchalMaxBonus: 0.6 },
};

export type ScoreComponent = "facility_coverage" | "facility_age" | "gosi_stage" | "timing";
