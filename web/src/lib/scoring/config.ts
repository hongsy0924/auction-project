/**
 * Scoring configuration for auction property investment analysis.
 * Score is 0-1.0 weighted across 5 factors.
 */

export const SCORING_CONFIG = {
    weights: {
        facility_coverage: 0.20,   // 도시계획시설 저촉 정도
        facility_age: 0.10,        // 시설결정 경과연수
        gosi_stage: 0.30,          // 사업 진행도 (highest weight)
        price_attractiveness: 0.25, // 가격 매력도
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
    price_attractiveness: [
        { maxRatio: 0.5, score: 1.0 },
        { maxRatio: 0.7, score: 0.7 },
        { maxRatio: 0.9, score: 0.4 },
        { maxRatio: 1.2, score: 0.1 },
    ],
    timing: { yuchalBonusPerCount: 0.15, yuchalMaxBonus: 0.6 },
};

export type ScoreComponent = "facility_coverage" | "facility_age" | "gosi_stage" | "price_attractiveness" | "timing";
