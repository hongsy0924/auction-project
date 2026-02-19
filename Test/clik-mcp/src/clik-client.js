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
exports.ClikClient = void 0;
var axios_1 = require("axios");
var API_BASE_URL = "https://clik.nanet.go.kr/openapi/minutes.do";
/**
 * Client for the CLIK Open API (지방의회 회의록)
 */
var ClikClient = /** @class */ (function () {
    function ClikClient(apiKey) {
        if (!apiKey) {
            throw new Error("CLIK API key is required");
        }
        this.apiKey = apiKey;
        this.http = axios_1.default.create({ timeout: 30000 });
    }
    /**
     * Search council minutes by keyword.
     */
    ClikClient.prototype.searchMinutes = function (params) {
        return __awaiter(this, void 0, void 0, function () {
            var queryParams, response, wrapper, items;
            var _a, _b, _c, _d, _e, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        queryParams = {
                            key: this.apiKey,
                            type: "json",
                            displayType: "list",
                            startCount: (_a = params.startCount) !== null && _a !== void 0 ? _a : 0,
                            listCount: (_b = params.listCount) !== null && _b !== void 0 ? _b : 10,
                            searchType: (_c = params.searchType) !== null && _c !== void 0 ? _c : "ALL",
                            searchKeyword: params.keyword,
                        };
                        if (params.councilCode) {
                            queryParams.rasmblyId = params.councilCode;
                        }
                        return [4 /*yield*/, this.http.get(API_BASE_URL, { params: queryParams })];
                    case 1:
                        response = _g.sent();
                        wrapper = response.data[0];
                        if (!wrapper || wrapper.RESULT_CODE !== "SUCCESS") {
                            throw new Error("CLIK API error: ".concat((_d = wrapper === null || wrapper === void 0 ? void 0 : wrapper.RESULT_CODE) !== null && _d !== void 0 ? _d : "NO_RESPONSE", " \u2014 ").concat((_e = wrapper === null || wrapper === void 0 ? void 0 : wrapper.RESULT_MESSAGE) !== null && _e !== void 0 ? _e : ""));
                        }
                        items = ((_f = wrapper.LIST) !== null && _f !== void 0 ? _f : []).map(function (entry) { return entry.ROW; });
                        return [2 /*return*/, {
                                totalCount: wrapper.TOTAL_COUNT,
                                items: items,
                            }];
                }
            });
        });
    };
    /**
     * Get the full detail (including transcript) of a specific minute.
     * Note: The detail endpoint returns fields directly on the response object,
     * unlike the list endpoint which uses LIST/ROW wrappers.
     */
    ClikClient.prototype.getMinuteDetail = function (docid) {
        return __awaiter(this, void 0, void 0, function () {
            var queryParams, response, wrapper, detail;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        queryParams = {
                            key: this.apiKey,
                            type: "json",
                            displayType: "detail",
                            docid: docid,
                        };
                        return [4 /*yield*/, this.http.get(API_BASE_URL, { params: queryParams })];
                    case 1:
                        response = _d.sent();
                        wrapper = response.data[0];
                        if (!wrapper || wrapper.RESULT_CODE !== "SUCCESS") {
                            throw new Error("CLIK API error: ".concat((_a = wrapper === null || wrapper === void 0 ? void 0 : wrapper.RESULT_CODE) !== null && _a !== void 0 ? _a : "NO_RESPONSE", " \u2014 ").concat((_b = wrapper === null || wrapper === void 0 ? void 0 : wrapper.RESULT_MESSAGE) !== null && _b !== void 0 ? _b : ""));
                        }
                        // Detail fields are directly on the wrapper object
                        if (!wrapper.DOCID)
                            return [2 /*return*/, null];
                        detail = {
                            DOCID: wrapper.DOCID,
                            RASMBLY_ID: wrapper.RASMBLY_ID,
                            RASMBLY_NM: wrapper.RASMBLY_NM,
                            MTGNM: wrapper.MTGNM,
                            MTG_DE: wrapper.MTG_DE,
                            RASMBLY_NUMPR: wrapper.RASMBLY_NUMPR,
                            RASMBLY_SESN: wrapper.RASMBLY_SESN,
                            MINTS_ODR: wrapper.MINTS_ODR,
                            PRMPST_CMIT_NM: wrapper.PRMPST_CMIT_NM,
                            MTR_SJ: wrapper.MTR_SJ,
                            MINTS_HTML: (_c = wrapper.MINTS_HTML) !== null && _c !== void 0 ? _c : "",
                        };
                        // Clean HTML from transcript content
                        if (detail.MINTS_HTML) {
                            detail.MINTS_HTML = this.stripHtml(detail.MINTS_HTML);
                        }
                        return [2 /*return*/, detail];
                }
            });
        });
    };
    /**
     * Clean MINTS_HTML to extract meaningful meeting content.
     * The raw HTML contains the entire page template (search forms, nav, fonts, etc.).
     * We extract only the actual transcript content.
     */
    ClikClient.prototype.stripHtml = function (html) {
        // First unescape JSON-escaped sequences (the API double-escapes HTML)
        var text = html
            .replace(/\\t/g, "")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "")
            .replace(/\\\//g, "/");
        // Extract speaker names and their lines for structured output
        // Pattern: <span class="speaker ...">NAME</span> followed by <div class="line">TEXT</div>
        var speakerBlocks = [];
        // Extract speaker name blocks
        var speakerRegex = /<div[^>]*class="line_name"[^>]*>([\s\S]*?)<\/div>/gi;
        var lineRegex = /<div[^>]*class="line"[^>]*>([\s\S]*?)<\/div>/gi;
        var tagRegex = /<div[^>]*class="tag"[^>]*>([\s\S]*?)<\/div>/gi;
        var matterRegex = /<div[^>]*class="(?:matter_icon|type_title)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        var timeRegex = /<div[^>]*class="time_icon"[^>]*>([\s\S]*?)<\/div>/gi;
        // Simple approach: strip tags but add structure markers
        text = text
            // Mark agenda items
            .replace(/<div[^>]*class="matter_icon"[^>]*>/gi, "\n\n【")
            .replace(/<div[^>]*class="type_title[^"]*"[^>]*>/gi, " ")
            // Mark time
            .replace(/<div[^>]*class="time_icon"[^>]*>/gi, "\n⏰ ")
            // Mark speakers
            .replace(/<div[^>]*class="line_name"[^>]*>/gi, "\n\n◆ ")
            // Mark speech lines
            .replace(/<div[^>]*class="line"[^>]*>/gi, "\n")
            // Mark tags (procedural notes like 의사봉)
            .replace(/<div[^>]*class="tag"[^>]*>/gi, "\n  ")
            // Mark attendance sections
            .replace(/<div[^>]*class="atd_title"[^>]*>/gi, "\n\n▶ ")
            .replace(/<div[^>]*class="atd_sub_title"[^>]*>/gi, "\n  • ");
        // Remove everything before the actual content (template/nav/forms)
        // The content typically starts after the header area
        var contentStart = text.indexOf("◆ ");
        var timeStart = text.indexOf("⏰ ");
        var agendaStart = text.indexOf("【");
        var starts = [contentStart, timeStart, agendaStart].filter(function (i) { return i > 0; });
        if (starts.length > 0) {
            text = text.slice(Math.min.apply(Math, starts));
        }
        // Now strip all remaining HTML tags
        text = text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<p[^>]*>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            // Decode HTML entities
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            // Clean up excessive whitespace
            .replace(/[ \t]+/g, " ")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return text;
    };
    return ClikClient;
}());
exports.ClikClient = ClikClient;
