// web/src/lib/eum/__tests__/client-proxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the cache module so tests don't hit real SQLite
vi.mock("../../minutes/cache", () => ({
    getCachedEumNotices: vi.fn().mockResolvedValue(null),
    setCachedEumNotices: vi.fn().mockResolvedValue(undefined),
    getCachedEumPermits: vi.fn().mockResolvedValue(null),
    setCachedEumPermits: vi.fn().mockResolvedValue(undefined),
    getCachedEumRestrictions: vi.fn().mockResolvedValue(null),
    setCachedEumRestrictions: vi.fn().mockResolvedValue(undefined),
}));

describe("EUM client proxy awareness", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe("when EUM_PROXY_URL is set (proxied mode)", () => {
        it("uses the proxy URL as base", async () => {
            process.env.EUM_PROXY_URL = "http://175.106.98.80:8080/eum";
            process.env.EUM_PROXY_KEY = "test-proxy-key";
            // EUM_API_ID and EUM_API_KEY intentionally NOT set —
            // in proxied mode the client should not need them

            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                text: async () => "<response><totalPage>0</totalPage><totalSize>0</totalSize></response>",
            });
            vi.stubGlobal("fetch", fetchSpy);

            const { getEumNotices } = await import("../client");
            await getEumNotices("11680");

            expect(fetchSpy).toHaveBeenCalled();
            const [url, options] = fetchSpy.mock.calls[0];

            // Should use proxy URL, not direct eum.go.kr
            expect(url).toContain("http://175.106.98.80:8080/eum/arMapList");

            // Should NOT contain id or key query params (proxy injects them)
            const parsedUrl = new URL(url);
            expect(parsedUrl.searchParams.has("id")).toBe(false);
            expect(parsedUrl.searchParams.has("key")).toBe(false);

            // Should include X-Proxy-Key header
            expect(options.headers).toHaveProperty("X-Proxy-Key", "test-proxy-key");
        });
    });

    describe("when EUM_PROXY_URL is NOT set (direct mode)", () => {
        it("uses direct eum.go.kr URL with credentials", async () => {
            delete process.env.EUM_PROXY_URL;
            delete process.env.EUM_PROXY_KEY;
            process.env.EUM_API_ID = "test-id";
            process.env.EUM_API_KEY = "test-key";

            const fetchSpy = vi.fn().mockResolvedValue({
                ok: true,
                text: async () => "<response><totalPage>0</totalPage><totalSize>0</totalSize></response>",
            });
            vi.stubGlobal("fetch", fetchSpy);

            const { getEumNotices } = await import("../client");
            await getEumNotices("11680");

            expect(fetchSpy).toHaveBeenCalled();
            const [url, options] = fetchSpy.mock.calls[0];

            // Should use direct EUM URL
            expect(url).toContain("https://api.eum.go.kr/web/Rest/OP/arMapList");

            // Should contain credentials in URL
            expect(url).toContain("id=test-id");
            expect(url).toContain("key=test-key");

            // Should NOT have proxy key header
            expect(options.headers).not.toHaveProperty("X-Proxy-Key");
        });

        it("returns empty array when EUM credentials are missing", async () => {
            delete process.env.EUM_PROXY_URL;
            delete process.env.EUM_API_ID;
            delete process.env.EUM_API_KEY;

            const fetchSpy = vi.fn();
            vi.stubGlobal("fetch", fetchSpy);

            const { getEumNotices } = await import("../client");
            const result = await getEumNotices("11680");

            // Should not call fetch at all
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });
    });
});
