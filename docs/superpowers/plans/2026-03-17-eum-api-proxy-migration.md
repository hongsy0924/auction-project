# EUM API Proxy Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route EUM API calls through an nginx proxy on the NCP VM to get a stable IP for IP whitelisting, with EUM credentials injected server-side.

**Architecture:** The Next.js app on Fly.io sends EUM requests (without credentials) to an nginx proxy on the NCP VM. The proxy validates a shared key, injects EUM `id`/`key`, and forwards to `eum.go.kr` over HTTPS. When `EUM_PROXY_URL` is unset, the client falls back to direct EUM access (existing behavior).

**Tech Stack:** nginx (reverse proxy), Next.js/TypeScript (client changes), vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-17-eum-api-proxy-migration-design.md`

---

## Chunk 1: Web App Code Changes

### Task 1: Write tests for proxy-aware EUM client behavior

**Files:**
- Create: `web/src/lib/eum/__tests__/client-proxy.test.ts`

The EUM client has no tests. We need to verify the proxy-aware branching logic works correctly before modifying the code.

- [ ] **Step 1: Write the test file**

```ts
// web/src/lib/eum/__tests__/client-proxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the module-level behavior by importing after setting env vars.
// Each test group reloads the module with different env configurations.

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run src/lib/eum/__tests__/client-proxy.test.ts`

Expected: FAIL — the current `client.ts` does not read `EUM_PROXY_URL` or send `X-Proxy-Key`.

### Task 2: Implement proxy-aware EUM client

**Files:**
- Modify: `web/src/lib/eum/client.ts:1-31` (header, base URL, auth params, proxy headers)
- Modify: `web/src/lib/eum/client.ts:81-84` (notices fetch)
- Modify: `web/src/lib/eum/client.ts:300-303` (permits fetch)
- Modify: `web/src/lib/eum/client.ts:405-408` (restrictions fetch)

- [ ] **Step 1: Update module header and add proxy-aware constants**

Replace lines 1-31 of `web/src/lib/eum/client.ts`:

```ts
/**
 * 토지이음 (eum.go.kr) 표준연계모듈 API client.
 *
 * Endpoints:
 *   - arMapList:      고시정보 (notices) — XML
 *   - arLandUseInfo:  토지이용규제 행위제한정보 — XML
 *   - isDevList:      개발 인허가 목록 조회 — JSON
 *
 * Auth: When EUM_PROXY_URL is set, requests go through the NCP proxy
 * which injects EUM credentials server-side. Otherwise, id + key query
 * parameters are sent directly to eum.go.kr (requires IP whitelisting).
 */
import { getXmlTag, getXmlTagAll } from "../xml-utils";
import {
    getCachedEumNotices,
    setCachedEumNotices,
    getCachedEumPermits,
    setCachedEumPermits,
    getCachedEumRestrictions,
    setCachedEumRestrictions,
    type CachedEumNotice,
    type CachedEumPermit,
    type CachedEumRestriction,
} from "../minutes/cache";

const EUM_BASE_URL = process.env.EUM_PROXY_URL || "https://api.eum.go.kr/web/Rest/OP";
const IS_PROXIED = !!process.env.EUM_PROXY_URL;

if (IS_PROXIED && !process.env.EUM_PROXY_KEY) {
    console.warn("[EUM] EUM_PROXY_URL is set but EUM_PROXY_KEY is missing — proxy will reject requests with 403");
}

function getAuthParams(): URLSearchParams | null {
    if (IS_PROXIED) {
        return new URLSearchParams();
    }
    const id = process.env.EUM_API_ID;
    const key = process.env.EUM_API_KEY;
    if (!id || !key) return null;
    return new URLSearchParams({ id, key });
}

function getProxyHeaders(): Record<string, string> {
    const proxyKey = process.env.EUM_PROXY_KEY;
    if (proxyKey) {
        return { "X-Proxy-Key": proxyKey };
    }
    return {};
}
```

- [ ] **Step 2: Add headers to the notices fetch call (~line 81)**

Find the fetch call in `getEumNotices`:

```ts
// Before:
            const response = await fetch(
                `${EUM_BASE_URL}/arMapList?${params}`,
                { signal: AbortSignal.timeout(15000) }
            );

// After:
            const response = await fetch(
                `${EUM_BASE_URL}/arMapList?${params}`,
                { signal: AbortSignal.timeout(15000), headers: getProxyHeaders() }
            );
```

- [ ] **Step 3: Add headers to the permits fetch call (~line 300)**

Find the fetch call in `getEumDevPermits`:

```ts
// Before:
            const response = await fetch(
                `${EUM_BASE_URL}/isDevList?${params}`,
                { signal: AbortSignal.timeout(15000) }
            );

// After:
            const response = await fetch(
                `${EUM_BASE_URL}/isDevList?${params}`,
                { signal: AbortSignal.timeout(15000), headers: getProxyHeaders() }
            );
```

- [ ] **Step 4: Add headers to the restrictions fetch call (~line 405)**

Find the fetch call in `getEumRestrictions`:

```ts
// Before:
        const response = await fetch(
            `${EUM_BASE_URL}/arLandUseInfo?${params}`,
            { signal: AbortSignal.timeout(15000) }
        );

// After:
        const response = await fetch(
            `${EUM_BASE_URL}/arLandUseInfo?${params}`,
            { signal: AbortSignal.timeout(15000), headers: getProxyHeaders() }
        );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/soonyoung/Desktop/auction-project/web && npx vitest run src/lib/eum/__tests__/client-proxy.test.ts`

Expected: All 3 tests PASS.

- [ ] **Step 6: Run typecheck to verify no type errors**

Run: `cd /Users/soonyoung/Desktop/auction-project/web && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/soonyoung/Desktop/auction-project
git add web/src/lib/eum/client.ts web/src/lib/eum/__tests__/client-proxy.test.ts
git commit -m "feat: add proxy-aware EUM API client

Route EUM API requests through NCP proxy when EUM_PROXY_URL is set.
Proxy injects EUM credentials server-side; client skips id/key params.
Falls back to direct eum.go.kr access when env var is unset."
```

### Task 3: Update .env.example

**Files:**
- Modify: `.env.example` (append after existing Frontend Settings, line 25)

- [ ] **Step 1: Add proxy env vars to .env.example**

Append after the existing Frontend Settings entries (after line 25):

```env

# --- EUM API Proxy (optional) ---
# When set, EUM API requests route through the NCP proxy which injects
# credentials server-side. Falls back to direct eum.go.kr if unset.
EUM_PROXY_URL=
EUM_PROXY_KEY=
```

- [ ] **Step 2: Commit**

```bash
cd /Users/soonyoung/Desktop/auction-project
git add .env.example
git commit -m "docs: add EUM proxy env vars to .env.example"
```

---

## Chunk 2: NCP VM Setup & Deployment

### Task 4: Set up nginx proxy on NCP VM

This task is performed manually on the NCP VM via SSH. The steps below are a runbook.

**Prerequisites:** SSH access to the NCP VM (`175.106.98.80`).

- [ ] **Step 1: Install nginx**

```bash
ssh <user>@175.106.98.80
sudo apt update && sudo apt install -y nginx
```

- [ ] **Step 2: Generate the proxy key**

```bash
# Run locally — save the output
openssl rand -hex 32
# Example output: a1b2c3d4e5f6...  (64 hex chars)
```

- [ ] **Step 3: Create secrets directory and files on the VM**

```bash
sudo mkdir -p /etc/nginx/secrets
sudo chmod 750 /etc/nginx/secrets

# Proxy key (replace <GENERATED_KEY> with the key from step 2)
echo 'set $proxy_key "<GENERATED_KEY>";' | sudo tee /etc/nginx/secrets/eum-proxy-key.conf
sudo chmod 640 /etc/nginx/secrets/eum-proxy-key.conf
sudo chown root:www-data /etc/nginx/secrets/eum-proxy-key.conf

# EUM API credentials (use your actual EUM credentials)
cat <<'CONF' | sudo tee /etc/nginx/secrets/eum-api-credentials.conf
set $eum_id "<YOUR_EUM_API_ID>";
set $eum_key "<YOUR_EUM_API_KEY>";
CONF
sudo chmod 640 /etc/nginx/secrets/eum-api-credentials.conf
sudo chown root:www-data /etc/nginx/secrets/eum-api-credentials.conf
```

- [ ] **Step 4: Write the nginx config**

```bash
cat <<'NGINX' | sudo tee /etc/nginx/sites-available/eum-proxy
limit_req_zone $binary_remote_addr zone=eum_limit:1m rate=10r/s;

server {
    listen 8080;

    include /etc/nginx/secrets/eum-proxy-key.conf;

    location = /health {
        default_type text/plain;
        return 200 "ok";
    }

    location /eum/ {
        if ($http_x_proxy_key != $proxy_key) {
            return 403;
        }

        limit_req zone=eum_limit burst=20 nodelay;

        include /etc/nginx/secrets/eum-api-credentials.conf;

        set $upstream_args "${args}&id=${eum_id}&key=${eum_key}";

        proxy_pass https://api.eum.go.kr/web/Rest/OP/?$upstream_args;
        proxy_set_header Host api.eum.go.kr;
        proxy_set_header X-Proxy-Key "";
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_ssl_server_name on;

        proxy_connect_timeout 10s;
        proxy_read_timeout 20s;
        proxy_send_timeout 10s;
    }

    location / {
        return 404;
    }

    log_format proxy_safe '$remote_addr - [$time_local] "$request_method $uri" '
                          '$status $body_bytes_sent';
    access_log /var/log/nginx/eum-proxy-access.log proxy_safe;
    error_log /var/log/nginx/eum-proxy-error.log warn;
}
NGINX
```

- [ ] **Step 5: Enable the site and start nginx**

```bash
# Remove default site if present
sudo rm -f /etc/nginx/sites-enabled/default

# Enable our proxy config
sudo ln -sf /etc/nginx/sites-available/eum-proxy /etc/nginx/sites-enabled/eum-proxy

# Test config syntax
sudo nginx -t

# Enable and start
sudo systemctl enable --now nginx
```

Expected: `nginx -t` outputs `syntax is ok` and `test is successful`.

- [ ] **Step 6: Test health check locally on the VM**

```bash
curl http://localhost:8080/health
```

Expected: `ok`

- [ ] **Step 7: Test auth rejection**

```bash
curl -v http://localhost:8080/eum/arMapList?areaCd=11680
```

Expected: HTTP 403 (no proxy key provided).

- [ ] **Step 8: Open port 8080 in NCP security group**

In the NCP console, add an inbound rule to the VM's security group:
- Protocol: TCP
- Port: 8080
- Source: 0.0.0.0/0

### Task 5: Whitelist NCP IP with EUM & test end-to-end

- [ ] **Step 1: Request IP whitelist with EUM**

Contact EUM (토지이음) to whitelist IP `175.106.98.80`. Keep the old Fly.io IP whitelisted during transition.

- [ ] **Step 2: Test proxy end-to-end from your local machine**

```bash
curl -v -H "X-Proxy-Key: <GENERATED_KEY>" \
  "http://175.106.98.80:8080/eum/arMapList?areaCd=11680&startDt=20240101&endDt=20260101&PageNo=1"
```

Expected: XML response with government notice data, or a valid empty result set (not an error page or 403).

### Task 6: Deploy to Fly.io and verify

- [ ] **Step 1: Set Fly.io secrets**

```bash
cd /Users/soonyoung/Desktop/auction-project/web
fly secrets set EUM_PROXY_URL="http://175.106.98.80:8080/eum" EUM_PROXY_KEY="<GENERATED_KEY>"
```

- [ ] **Step 2: Deploy**

```bash
cd /Users/soonyoung/Desktop/auction-project
make deploy
```

- [ ] **Step 3: Verify 투자시그널 tab**

1. Open the app in browser
2. Navigate to the 투자시그널 tab
3. Trigger precompute: `curl -H "X-Secret: <PRECOMPUTE_SECRET>" https://applemango.fly.dev/api/signal-top/precompute`
4. Verify signal data appears in the tab

- [ ] **Step 4: Clean up (after verification)**

- Remove old Fly.io IP from EUM whitelist
- Optionally remove `EUM_API_ID` and `EUM_API_KEY` from Fly.io secrets (no longer needed since proxy handles auth):
  ```bash
  fly secrets unset EUM_API_ID EUM_API_KEY
  ```
