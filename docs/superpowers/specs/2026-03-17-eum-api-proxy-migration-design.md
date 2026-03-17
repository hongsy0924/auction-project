# EUM API Proxy Migration Design

## Problem

The 투자시그널 tab depends on the EUM API (`api.eum.go.kr`), which requires IP whitelisting. The web app runs on Fly.io, whose outbound IPs are shared and can change without notice. This makes the IP whitelist fragile and is the reason the tab is currently non-functional.

## Solution

Route EUM API traffic through a lightweight nginx reverse proxy on the existing NCP VM (`175.106.98.80`), which has a static public IP. The web app stays on Fly.io; only EUM requests are proxied.

## Architecture

```
Fly.io (Next.js app)              NCP VM (175.106.98.80)            EUM API
────────────────────              ──────────────────────            ────────────────────
GET /eum/arMapList?...   ──→     nginx :8080                 ──→  api.eum.go.kr/web/Rest/OP
    + X-Proxy-Key header          - validates X-Proxy-Key
                                  - proxy_pass to eum.go.kr
                                  - strips proxy key upstream
```

### What stays the same

- Web app hosted on Fly.io (free tier)
- Crawler runs on NCP VM (daily 5 AM cron)
- All non-EUM APIs (CLIK, Gemini, LURIS, VWorld) called directly from Fly.io
- SQLite databases on Fly.io persistent volumes
- Minutes search, auction list, auth — all unaffected

### What changes

| Component | Before | After |
|-----------|--------|-------|
| EUM API calls | Fly.io → eum.go.kr (direct) | Fly.io → NCP proxy → eum.go.kr |
| IP whitelisted with EUM | Fly.io IP (unstable) | NCP IP `175.106.98.80` (static) |
| `web/src/lib/eum/client.ts` | Hardcoded `EUM_BASE_URL` | Reads `EUM_PROXY_URL` env var with fallback |

## Detailed Design

### 1. NCP Proxy (nginx)

nginx reverse proxy on the NCP VM, listening on port 8080.

**Config (`/etc/nginx/sites-available/eum-proxy`):**

```nginx
server {
    listen 8080;

    # Reject requests without valid proxy key
    set $valid "";
    if ($http_x_proxy_key = "<EUM_PROXY_KEY_VALUE>") {
        set $valid "yes";
    }
    if ($valid != "yes") {
        return 403;
    }

    location /eum/ {
        proxy_pass https://api.eum.go.kr/web/Rest/OP/;
        proxy_set_header Host api.eum.go.kr;
        proxy_set_header X-Proxy-Key "";
        proxy_ssl_server_name on;
    }

    location / {
        return 404;
    }
}
```

**Endpoints proxied:**

| Proxy path | Upstream | Response format |
|------------|----------|-----------------|
| `/eum/arMapList` | `api.eum.go.kr/web/Rest/OP/arMapList` | XML |
| `/eum/isDevList` | `api.eum.go.kr/web/Rest/OP/isDevList` | JSON |
| `/eum/arLandUseInfo` | `api.eum.go.kr/web/Rest/OP/arLandUseInfo` | XML |

**Resource impact:** ~2MB RAM idle. EUM traffic is light (dozens of requests/day at most, cached with 7-day TTL).

**Security:**
- `X-Proxy-Key` header required on all requests (shared secret, 403 without it)
- Key stripped before forwarding to EUM (no leak upstream)
- Only `/eum/` location proxied; all other paths return 404
- Upstream connection to eum.go.kr uses HTTPS (EUM credentials in query params are encrypted in transit)
- Fly.io → NCP is plain HTTP on port 8080 (acceptable: proxy key authenticates, EUM credentials travel over HTTPS to eum.go.kr)

**NCP firewall:** Inbound TCP 8080 must be allowed in NCP security group.

### 2. Web App Changes

**File: `web/src/lib/eum/client.ts`**

Change the base URL to read from environment:

```ts
// Before
const EUM_BASE_URL = "https://api.eum.go.kr/web/Rest/OP";

// After
const EUM_BASE_URL = process.env.EUM_PROXY_URL || "https://api.eum.go.kr/web/Rest/OP";
```

Add proxy key header to all 3 fetch calls (lines ~82, ~300, ~405):

```ts
function getProxyHeaders(): Record<string, string> {
    const proxyKey = process.env.EUM_PROXY_KEY;
    if (proxyKey) {
        return { "X-Proxy-Key": proxyKey };
    }
    return {};
}

// In each fetch call:
const response = await fetch(`${EUM_BASE_URL}/arMapList?${params}`, {
    signal: AbortSignal.timeout(15000),
    headers: getProxyHeaders(),
});
```

**File: `.env.example`**

Add placeholder entries:

```env
# EUM API Proxy (optional — falls back to direct eum.go.kr if unset)
EUM_PROXY_URL=
EUM_PROXY_KEY=
```

**Local development:** Without `EUM_PROXY_URL` set, the client falls back to the direct EUM URL. No change to local dev workflow.

### 3. Environment Variables

| Variable | Location | Value | Committed? |
|----------|----------|-------|------------|
| `EUM_PROXY_URL` | Fly.io secrets | `http://175.106.98.80:8080/eum` | No |
| `EUM_PROXY_KEY` | Fly.io secrets + NCP nginx config | `openssl rand -hex 32` output | No |
| `EUM_API_ID` | Fly.io secrets (unchanged) | existing value | No |
| `EUM_API_KEY` | Fly.io secrets (unchanged) | existing value | No |

## Deployment Plan

Steps are ordered so that nothing breaks at any intermediate point.

1. **Set up NCP proxy** — install nginx, add config, open port 8080, test locally on the VM
2. **Whitelist NCP IP with EUM** — request `175.106.98.80`. Keep old Fly.io IP during transition
3. **Test proxy end-to-end** — curl from external machine through proxy to confirm EUM responds
4. **Deploy web app changes** — set Fly.io secrets (`EUM_PROXY_URL`, `EUM_PROXY_KEY`), deploy updated code
5. **Verify 투자시그널 tab** — trigger precompute, confirm signal data flows
6. **Remove old Fly.io IP from EUM whitelist** — only after confirming everything works

## Rollback

- **Before step 4:** Web app is unchanged, no impact
- **After step 4:** Remove `EUM_PROXY_URL` from Fly.io secrets → app falls back to direct EUM URL (still whitelisted until step 6)
- **After step 6:** Re-add Fly.io IP to EUM whitelist, remove `EUM_PROXY_URL` from Fly.io

## Files Changed

| File | Change |
|------|--------|
| `web/src/lib/eum/client.ts` | Read `EUM_PROXY_URL` env var, add `getProxyHeaders()` helper, attach header to 3 fetch calls |
| `.env.example` | Add `EUM_PROXY_URL` and `EUM_PROXY_KEY` placeholder entries |

## Out of Scope

- TLS on the proxy (can be added later with Let's Encrypt if desired)
- Migrating the web app off Fly.io
- Changes to the crawler, minutes search, or any other component
- CI/CD pipeline changes
