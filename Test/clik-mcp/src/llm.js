"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseQuery = parseQuery;
exports.summarizeMinutes = summarizeMinutes;
var generative_ai_1 = require("@google/generative-ai");
var genAI = null;
var activeModel = null;
function getModel() {
    if (activeModel)
        return activeModel;
    var API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in environment variables.");
    }
    genAI = new generative_ai_1.GoogleGenerativeAI(API_KEY);
    activeModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    return activeModel;
}
function parseQuery(query) {
    return __awaiter(this, void 0, void 0, function () {
        var model, prompt, result, response, text, cleaned;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    model = getModel();
                    prompt = "\n    You are a query parser for a Korean local council minutes search engine.\n    Analyze the following natural language query and extract:\n    1. 'council': The name of the local council or region (e.g. \"\uC11C\uC0B0\uC2DC\", \"\uC885\uB85C\uAD6C\", \"\uC11C\uC6B8\uC2DC\"). If not found, return null.\n    2. 'keyword': The main topic or keyword to search for (e.g. \"\uC11D\uC9C0\uC81C\", \"\uC7AC\uB09C\uC9C0\uC6D0\uAE08\"). Remove common stopwords like \"\uCD5C\uADFC\", \"\uC5B8\uAE09\", \"\uAD00\uB828\", \"\uC788\uC5B4?\", \"\uC54C\uB824\uC918\".\n    3. 'intent': A brief description of what the user wants (e.g. \"search_mentions\", \"summarize_content\").\n\n    Query: \"".concat(query, "\"\n\n    Return ONLY a JSON object:\n    {\n        \"council\": \"string or null\",\n        \"keyword\": \"string\",\n        \"intent\": \"string\"\n    }\n    ");
                    return [4 /*yield*/, model.generateContent(prompt)];
                case 1:
                    result = _a.sent();
                    return [4 /*yield*/, result.response];
                case 2:
                    response = _a.sent();
                    text = response.text();
                    try {
                        cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
                        return [2 /*return*/, JSON.parse(cleaned)];
                    }
                    catch (e) {
                        console.error("Failed to parse LLM response:", text);
                        throw new Error("LLM response was not valid JSON");
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function summarizeMinutes(query, minutes) {
    return __awaiter(this, void 0, void 0, function () {
        var model, context, prompt, result, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    model = getModel();
                    if (minutes.length === 0) {
                        return [2 /*return*/, "관련된 회의록 내용을 찾을 수 없습니다."];
                    }
                    context = minutes.map(function (m) { return "\n    [Date: ".concat(m.date, "]\n    [Meeting: ").concat(m.meeting, "]\n    [Excerpt]:\n    ").concat(m.content, "\n    ---\n    "); }).join("\n");
                    prompt = "\n    You are a helpful assistant for analyzing local council meeting minutes.\n    User Query: \"".concat(query, "\"\n\n    Found Minutes:\n    ").concat(context, "\n\n    Please verify if the keyword in the user's query is actually mentioned in the contexts.\n    If mentioned, summarize the key discussions regarding that topic.\n    If not mentioned or irrelevant, state that cleanly.\n    Provide the answer in Korean, natural and concise.\n    Citing the date and meeting name is helpful.\n    ");
                    return [4 /*yield*/, model.generateContent(prompt)];
                case 1:
                    result = _a.sent();
                    return [4 /*yield*/, result.response];
                case 2:
                    response = _a.sent();
                    return [2 /*return*/, response.text()];
            }
        });
    });
}
