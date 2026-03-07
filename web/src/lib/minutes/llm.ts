import { GoogleGenAI } from "@google/genai";

let genAI: GoogleGenAI | null = null;

const SYSTEM_PROMPT = `You are an expert AI assistant for real estate auction and sale investors.
The user searches Korean local council (지방의회) meeting minutes to find signals regarding public projects that could impact the value of specific land or properties.
Specifically, the user is looking for:
1. Whether a specific land or parcel is likely to be incorporated (편입) into a public project.
2. The progress and signals of projects that might affect the surrounding area (e.g., 예산 배정/편성, 사업 착수, 용역 발주, 설계 완료, 착공, 토지 보상, 실시계획 인가, 도시계획 변경, 교부세 확보, 추경 반영).
Your goal is to accurately extract and summarize these investment-relevant signals from the council minutes, helping the user make informed investment decisions.`;

function getModel() {
    if (genAI) return genAI;

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not set in environment variables.");

    genAI = new GoogleGenAI({ apiKey: API_KEY });
    return genAI;
}

export interface ParsedQuery {
    council: string | null;
    keywords: string[];
    intent: string;
    analysisFocus?: string[];
}

export async function parseQuery(query: string): Promise<ParsedQuery> {
    const ai = getModel();
    const prompt = `${SYSTEM_PROMPT}

You are a query parser for a Korean local council minutes search engine used for land auction research.
Analyze the following natural language query and extract:

1. 'council': The name of the local council or region (e.g. "서산시", "종로구"). If not found, return null.
2. 'keywords': An array of search terms to use with the CLIK API. 
   - ALWAYS include the broadest/shortest core keyword first (e.g. "석지제").
   - Optionally add 1-2 narrower variants if the user mentions specific aspects (e.g. "석지제 예산").
   - Do NOT include generic words like "사업", "관련", "언급", "편입" as standalone keywords.
   - Keep keywords short and specific — the API does full-text search.
3. 'intent': A brief description of what the user wants (e.g. "search_mentions", "find_budget_signals").
4. 'analysisFocus': An array of specific aspects the user wants to investigate.
   - Extract from the user's query (e.g. "예산 배정" → ["예산 배정"], "편입" → ["토지 편입 여부"])
   - If the user doesn't specify, infer reasonable defaults based on the domain context: 
     ["예산 배정", "사업 진척 현황", "토지 편입 및 보상 관련 논의"]

Query: "${query}"

Return ONLY a JSON object:
{
    "council": "string or null",
    "keywords": ["string", ...],
    "intent": "string",
    "analysisFocus": ["string", ...]
}
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt
    });
    const text = response.text;

    if (!text) {
        throw new Error("LLM returned empty response");
    }

    try {
        const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        // Normalize: LLM may return "keyword" (string) instead of "keywords" (array)
        if (!parsed.keywords && parsed.keyword) {
            parsed.keywords = Array.isArray(parsed.keyword)
                ? parsed.keyword
                : [parsed.keyword];
        }
        if (!Array.isArray(parsed.keywords)) {
            parsed.keywords = parsed.keywords ? [parsed.keywords] : [];
        }
        if (!parsed.analysisFocus) {
            parsed.analysisFocus = ["예산 배정", "사업 진척 현황", "토지 편입 및 보상 관련 논의"];
        }

        return parsed as ParsedQuery;
    } catch {
        console.error("Failed to parse LLM response:", text);
        throw new Error("LLM response was not valid JSON");
    }
}

function buildSummarizePrompt(
    query: string,
    minutes: { date: string; meeting: string; content: string }[],
    analysisFocus?: string[]
): string {
    const context = minutes
        .map(
            (m) => `
[Date: ${m.date}]
[Meeting: ${m.meeting}]
[Excerpt]:
${m.content}
---
`
        )
        .join("\n");

    const focusInstruction = analysisFocus?.length
        ? `
The user is specifically interested in these aspects:
${analysisFocus.map((f) => `- ${f}`).join("\n")}

For each meeting where the topic is mentioned, pay special attention to:
- Whether budget allocation (예산 배정/편성) was discussed and the amount.
- Whether project progress signals exist (착공, 설계, 용역 발주, 실시계획 인가, 토지보상 등).
- Mentions of land incorporation (토지 편입) or compensation (보상).
- Any timeline or schedule information.
- Any opposition or issues raised.
Organize your findings chronologically to show the project's progression over time.
`
        : "";

    return `${SYSTEM_PROMPT}

User Query: "${query}"

${focusInstruction}

Found Minutes (keyword-adjacent excerpts from council meeting transcripts):
${context}

Instructions:
1. Verify if the topic from the user's query is actually mentioned in the excerpts.
2. If not mentioned or irrelevant, state cleanly that no relevant investment signals were found.
3. If mentioned, structure your response EXACTLY in the following Markdown format (do not use other formats):

**📌 사업 현황 및 방향성**
- (Summarize the current phase of the project, whether it is progressing, delayed, or canceled.)

**💰 예산 및 자금 확보**
- (Highlight specific budget amounts, funding sources, or budget cuts.)

**🗺️ 토지 편입 및 보상 시그널**
- (Explicitly state if there's any mention of land incorporation (편입), expropriation, or compensation (보상) schedules/methods.)

**⏱️ 시계열 흐름 (Timeline)**
- [YYYY.MM (Meeting Name)]: (Key decision or discussion point)
- [YYYY.MM (Meeting Name)]: (Key decision or discussion point)
... (Organize chronologically)

**⚠️ 잠재적 리스크**
- (Note any opposing views from council members, resident complaints, or reasons for delay.)

**🏢 담당 기관/부서**
- (Note which specific government departments or officials answered the questions, if mentioned.)

4. Provide the answer in Korean, natural and concise.
5. Base your answers strictly on the provided excerpts.
`;
}

export function buildPropertyAnalysisPrompt(context: {
    address: string;
    dong: string;
    pnu: string;
    urbanFacilities: { facilityName: string; facilityType: string; decisionDate?: string; executionStatus?: string }[];
    minutes: { date: string; meeting: string; content: string }[];
}): string {
    const facilityList = context.urbanFacilities.length > 0
        ? context.urbanFacilities
            .map((f) => `- ${f.facilityType}: ${f.facilityName} (결정일: ${f.decisionDate || "불명"}, 상태: ${f.executionStatus || "불명"})`)
            .join("\n")
        : "- 도시계획시설 정보 없음";

    const minutesList = context.minutes
        .map((m) => `[${m.date}] [${m.meeting}]\n${m.content}\n---`)
        .join("\n\n");

    return `${SYSTEM_PROMPT}

## 분석 대상 물건
- 주소: ${context.address}
- 행정동/면: ${context.dong}
- PNU: ${context.pnu}

## 이 필지의 도시계획시설 현황 (LURIS)
${facilityList}

## 관련 지방의회 회의록 발췌
${minutesList || "관련 회의록 없음"}

## 분석 요청

이 경매 물건에 대해 다음을 분석해주세요:

1. **사업 연결 분석**: 위 회의록에서 이 물건의 소재지(${context.dong})와 관련된 공공사업 시그널을 추출하세요.
2. **교차 검증**: 도시계획시설 현황과 회의록 내용을 교차 검증하여, 이 물건이 영향받을 가능성을 평가하세요.
3. **투자 인사이트**: 투자 판단에 도움이 될 핵심 정보를 요약하세요.

출력 형식 (마크다운):

**📍 물건 위치 분석**
- (이 물건의 위치와 도시계획시설과의 관계)

**📌 사업 시그널**
- (회의록에서 발견된 관련 사업 논의)

**💰 보상/편입 가능성**
- (토지보상, 편입 관련 시그널 및 가능성 평가)

**⏱️ 사업 진행 타임라인**
- (시간순으로 정리된 사업 진행 현황)

**⚠️ 리스크 요소**
- (투자 시 주의해야 할 점)

**🔍 종합 판단**
- (이 물건의 투자 가치에 대한 종합 의견)

한국어로 간결하고 구체적으로 작성하세요. 제공된 자료에 근거하여 답변하세요.
`;
}

export async function summarizeMinutes(
    query: string,
    minutes: { date: string; meeting: string; content: string }[],
    analysisFocus?: string[]
): Promise<string> {
    const ai = getModel();
    if (minutes.length === 0) {
        return "관련된 회의록 내용을 찾을 수 없습니다.";
    }

    const prompt = buildSummarizePrompt(query, minutes, analysisFocus);
    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt
    });
    return response.text || "응답을 생성할 수 없습니다.";
}

/**
 * Streaming version of summarizeMinutes.
 * Calls onToken for each chunk of text as it arrives from the LLM.
 */
export async function summarizeMinutesStream(
    query: string,
    minutes: { date: string; meeting: string; content: string }[],
    analysisFocus: string[] | undefined,
    onToken: (token: string) => void
): Promise<string> {
    const ai = getModel();
    if (minutes.length === 0) {
        const msg = "관련된 회의록 내용을 찾을 수 없습니다.";
        onToken(msg);
        return msg;
    }

    const prompt = buildSummarizePrompt(query, minutes, analysisFocus);

    const response = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: prompt
    });

    let fullText = "";
    for await (const chunk of response) {
        const text = chunk.text;
        if (text) {
            fullText += text;
            onToken(text);
        }
    }

    return fullText || "응답을 생성할 수 없습니다.";
}
