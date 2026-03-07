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
