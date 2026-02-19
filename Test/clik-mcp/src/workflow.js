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
exports.MinutesService = void 0;
var clik_client_js_1 = require("./clik-client.js");
var llm_js_1 = require("./llm.js");
var councils_js_1 = require("./data/councils.js");
var MinutesService = /** @class */ (function () {
    function MinutesService(apiKey) {
        this.clikClient = new clik_client_js_1.ClikClient(apiKey);
    }
    MinutesService.prototype.processQuery = function (userQuery) {
        return __awaiter(this, void 0, void 0, function () {
            var parsed, councilCode, councilName, mapped, searchResult, detailsPromises, details, contexts, summary;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // 1. Parse Query with LLM
                        console.log("Analyzing query: \"".concat(userQuery, "\"..."));
                        return [4 /*yield*/, (0, llm_js_1.parseQuery)(userQuery)];
                    case 1:
                        parsed = _a.sent();
                        console.log("Parsed:", parsed);
                        if (!parsed.keyword) {
                            return [2 /*return*/, "검색할 키워드를 찾지 못했습니다. 다시 질문해 주세요."];
                        }
                        councilName = "전체 의회";
                        if (parsed.council) {
                            mapped = (0, councils_js_1.findCouncilId)(parsed.council);
                            if (mapped) {
                                councilCode = mapped.code;
                                councilName = mapped.name;
                                console.log("Mapped \"".concat(parsed.council, "\" to ").concat(councilCode, " (").concat(councilName, ")"));
                            }
                            else {
                                console.warn("Could not find council code for \"".concat(parsed.council, "\". Searching all councils."));
                                // Optional: ask user for clarification or default to a specific one?
                                // For now, proceed without code (search all) but warn.
                            }
                        }
                        // 3. Search Minutes
                        console.log("Searching for \"".concat(parsed.keyword, "\" in ").concat(councilName, "..."));
                        return [4 /*yield*/, this.clikClient.searchMinutes({
                                keyword: parsed.keyword,
                                councilCode: councilCode,
                                listCount: 5 // Fetch top 5 relevant findings
                            })];
                    case 2:
                        searchResult = _a.sent();
                        if (searchResult.totalCount === 0) {
                            return [2 /*return*/, "\"".concat(parsed.keyword, "\"\uC5D0 \uB300\uD55C \uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.")];
                        }
                        console.log("Found ".concat(searchResult.totalCount, " results. Fetching details for top ").concat(searchResult.items.length, "..."));
                        detailsPromises = searchResult.items.map(function (item) { return __awaiter(_this, void 0, void 0, function () {
                            var detail, e_1;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        _a.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, this.clikClient.getMinuteDetail(item.DOCID)];
                                    case 1:
                                        detail = _a.sent();
                                        return [2 /*return*/, detail];
                                    case 2:
                                        e_1 = _a.sent();
                                        console.error("Failed to fetch detail for ".concat(item.DOCID), e_1);
                                        return [2 /*return*/, null];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); });
                        return [4 /*yield*/, Promise.all(detailsPromises)];
                    case 3:
                        details = (_a.sent()).filter(function (d) { return d !== null; });
                        contexts = details.map(function (d) {
                            var content = d.MINTS_HTML || "";
                            // Simple truncation or windowing around keyword could happen here
                            // But let's pass a decent chunk to Gemini (e.g. first 20k chars or windowed)
                            // For efficiency, let's try to extract a window around the keyword if the content is huge
                            var windowSize = 2000;
                            var idx = content.indexOf(parsed.keyword);
                            var excerpt = "";
                            if (idx !== -1) {
                                var start = Math.max(0, idx - windowSize / 2);
                                excerpt = content.substring(start, start + windowSize);
                            }
                            else {
                                excerpt = content.substring(0, windowSize); // Fallback to beginning
                            }
                            return {
                                date: d.MTG_DE,
                                meeting: "".concat(d.RASMBLY_NM, " ").concat(d.MTGNM),
                                content: excerpt
                            };
                        });
                        // 5. Summarize with LLM
                        console.log("Summarizing results...");
                        return [4 /*yield*/, (0, llm_js_1.summarizeMinutes)(userQuery, contexts)];
                    case 4:
                        summary = _a.sent();
                        return [2 /*return*/, summary];
                }
            });
        });
    };
    return MinutesService;
}());
exports.MinutesService = MinutesService;
