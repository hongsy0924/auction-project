# EUM API Proxy Migration Design

## Problem

The 투자시그널 tab depends on the EUM API (`api.eum.go.kr`), which requires IP whitelisting. The web app runs on Fly.io, whose outbound IPs are shared and can change without notice. This makes the IP whitelist fragile and is the reason the tab is currently non-functional.

## Solution

Route EUM API traffic through a lightweight nginx reverse proxy on the existing NCP VM (`175.106.98.80`), which has a static public IP. The web app stays on Fly.io; only EUM requests are proxied. The proxy injects EUM API credentials server-side so they never travel unencrypted.

## Architecture

```
Fly.io (Next.js app)                 NCP VM (175.106.98.80)                  EUM API
────────────────────                 ──────────────────────                  ────────────────────
GET /eum/arMapList?areaCd=...  ──→  nginx :8080                       ──→  api.eum.go.kr/web/Rest/OP
    + X-Proxy-Key header             - validates X-Proxy-Key
    (no EUM credentials)             - injects EUM id+key server-side
                                     - proxy_pass over HTTPS to eum.go.kr
```

**Key security property:** The client sends only non-sensitive query params (areaCd, dates, PageNo) over the unencrypted Fly.io → NCP hop. EUM API credentials (`id`/`key`) are injected at the proxy layer and only travel over HTTPS to `eum.go.kr`.

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
| EUM credentials location | Fly.io env vars, sent by client | NCP proxy config, injected server-side |
| `web/src/lib/eum/client.ts` | Hardcoded `EUM_BASE_URL`, client sends `id`/`key` | Reads `EUM_PROXY_URL` env var, skips `id`/`key` when proxied |

## Detailed Design

### 1. NCP Proxy (nginx)

nginx reverse proxy on the NCP VM, listening on port 8080.

**Config (`/etc/nginx/sites-available/eum-proxy`):**

```nginx
# Rate limiting: 10 req/s with burst of 20
limit_req_zone $binary_remote_addr zone=eum_limit:1m rate=10r/s;

server {
    listen 8080;

    # --- Shared proxy key (loaded for use in location blocks) ---
    include /etc/nginx/secrets/eum-proxy-key.conf;
    # eum-proxy-key.conf contains: set $proxy_key "<value>";

    # --- Health check (no auth required) ---
    location = /health {
        default_type text/plain;
        return 200 "ok";
    }

    # --- EUM API proxy (auth required) ---
    location /eum/ {
        # Auth: reject requests without valid proxy key
        if ($http_x_proxy_key != $proxy_key) {
            return 403;
        }

        limit_req zone=eum_limit burst=20 nodelay;

        # Inject EUM credentials server-side
        include /etc/nginx/secrets/eum-api-credentials.conf;
        # eum-api-credentials.conf contains:
        #   set $eum_id "<YOUR_EUM_API_ID>";
        #   set $eum_key "<YOUR_EUM_API_KEY>";

        # Append EUM auth params to the upstream query string
        set $upstream_args "${args}&id=${eum_id}&key=${eum_key}";

        proxy_pass https://api.eum.go.kr/web/Rest/OP/?$upstream_args;
        proxy_set_header Host api.eum.go.kr;
        proxy_set_header X-Proxy-Key "";
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_ssl_server_name on;

        # Timeouts aligned with client's 15s AbortSignal
        proxy_connect_timeout 10s;
        proxy_read_timeout 20s;
        proxy_send_timeout 10s;
    }

    # Block everything else
    location / {
        return 404;
    }

    # --- Logging: omit query strings (contain EUM credentials upstream) ---
    log_format proxy_safe '$remote_addr - [$time_local] "$request_method $uri" '
                          '$status $body_bytes_sent';
    access_log /var/log/nginx/eum-proxy-access.log proxy_safe;
    error_log /var/log/nginx/eum-proxy-error.log warn;
}
```

**Secrets files** (restricted permissions):

```
/etc/nginx/secrets/eum-proxy-key.conf       # chmod 640, root:www-data
/etc/nginx/secrets/eum-api-credentials.conf  # chmod 640, root:www-data
```

These files are created manually on the VM and never committed to git.

**Endpoints proxied:**

| Proxy path | Upstream | Response format |
|------------|----------|-----------------|
| `/eum/arMapList` | `api.eum.go.kr/web/Rest/OP/arMapList` | XML |
| `/eum/isDevList` | `api.eum.go.kr/web/Rest/OP/isDevList` | JSON |
| `/eum/arLandUseInfo` | `api.eum.go.kr/web/Rest/OP/arLandUseInfo` | XML |

**Resource impact:** ~2MB RAM idle. EUM traffic is light (dozens of requests/day at most, cached with 7-day TTL).

**Security:**
- `X-Proxy-Key` header required on all requests (shared secret, 403 without it)
- Proxy key stored in a separate include file with restricted permissions (`chmod 640 root:www-data`)
- Key stripped before forwarding to EUM (no leak upstream)
- EUM credentials injected at the proxy layer — never sent by the client, never travel unencrypted
- Only `/eum/` location proxied; all other paths return 404
- Rate limited to 10 req/s with burst of 20 to prevent abuse
- Access logs use a custom format that omits query strings (which contain EUM credentials on the upstream side)

**NCP firewall:** Inbound TCP 8080 must be allowed in NCP security group.

### 2. Web App Changes

**File: `web/src/lib/eum/client.ts`**

Change the base URL to read from environment:

```ts
// Before
const EUM_BASE_URL = "https://api.eum.go.kr/web/Rest/OP";

// After
const EUM_BASE_URL = process.env.EUM_PROXY_URL || "https://api.eum.go.kr/web/Rest/OP";
const IS_PROXIED = !!process.env.EUM_PROXY_URL;
```

Modify `getAuthParams()` to skip credentials when proxied (proxy injects them):

```ts
function getAuthParams(): URLSearchParams | null {
    if (IS_PROXIED) {
        // Proxy injects EUM credentials server-side; don't send them over HTTP
        return new URLSearchParams();
    }
    const id = process.env.EUM_API_ID;
    const key = process.env.EUM_API_KEY;
    if (!id || !key) return null;
    return new URLSearchParams({ id, key });
}
```

Add proxy key header helper:

```ts
function getProxyHeaders(): Record<string, string> {
    const proxyKey = process.env.EUM_PROXY_KEY;
    if (proxyKey) {
        return { "X-Proxy-Key": proxyKey };
    }
    return {};
}
```

Attach headers to all 3 fetch calls (lines ~82, ~300, ~405):

```ts
// In each fetch call, add headers:
const response = await fetch(`${EUM_BASE_URL}/arMapList?${params}`, {
    signal: AbortSignal.timeout(15000),
    headers: getProxyHeaders(),
});
```

**File: `.env.example`**

Add under the existing Frontend Settings section:

```env
# EUM API Proxy (optional — falls back to direct eum.go.kr if unset)
# When set, EUM credentials are injected server-side by the proxy
EUM_PROXY_URL=
EUM_PROXY_KEY=
```

**Local development:** Without `EUM_PROXY_URL` set, the client falls back to direct EUM URL with `id`/`key` in query params (existing behavior). No change to local dev workflow.

### 3. Environment Variables

| Variable | Location | Value | Committed? |
|----------|----------|-------|------------|
| `EUM_PROXY_URL` | Fly.io secrets | `http://175.106.98.80:8080/eum` | No |
| `EUM_PROXY_KEY` | Fly.io secrets + NCP `/etc/nginx/secrets/eum-proxy-key.conf` | `openssl rand -hex 32` output | No |
| `EUM_API_ID` | NCP `/etc/nginx/secrets/eum-api-credentials.conf` only | existing value | No |
| `EUM_API_KEY` | NCP `/etc/nginx/secrets/eum-api-credentials.conf` only | existing value | No |

**Note:** After migration, `EUM_API_ID` and `EUM_API_KEY` can be removed from Fly.io secrets since the proxy handles authentication. Keep them during transition for rollback.

### 4. Health Check & Monitoring

The nginx config includes a `/health` endpoint (no auth required) that returns HTTP 200.

**Recommended monitoring:** Set up a free external uptime monitor (e.g., UptimeRobot) pointing at `http://175.106.98.80:8080/health` with alerting to your preferred channel. This detects proxy downtime before users notice missing signal data.

## Deployment Plan

Steps are ordered so that nothing breaks at any intermediate point.

1. **Set up NCP proxy**
   - `apt install nginx`
   - Create `/etc/nginx/secrets/` directory (`chmod 750 root:www-data`)
   - Write `eum-proxy-key.conf` and `eum-api-credentials.conf` (`chmod 640 root:www-data`)
   - Add nginx config at `/etc/nginx/sites-available/eum-proxy`, symlink to `sites-enabled`
   - `systemctl enable --now nginx`
   - Test locally: `curl -H "X-Proxy-Key: <key>" http://localhost:8080/health`

2. **Whitelist NCP IP with EUM** — request `175.106.98.80`. Keep old Fly.io IP during transition

3. **Test proxy end-to-end** — from an external machine:
   ```bash
   curl -v -H "X-Proxy-Key: <key>" \
     "http://175.106.98.80:8080/eum/arMapList?areaCd=11680&startDt=20240101&endDt=20260101&PageNo=1"
   ```
   Expect XML response with government notice data (or an empty result set).

4. **Deploy web app changes** — set Fly.io secrets (`EUM_PROXY_URL`, `EUM_PROXY_KEY`), deploy updated code

5. **Verify 투자시그널 tab** — trigger precompute, confirm signal data flows

6. **Clean up** — remove old Fly.io IP from EUM whitelist; optionally remove `EUM_API_ID`/`EUM_API_KEY` from Fly.io secrets

## Rollback

- **Before step 4:** Web app is unchanged, no impact
- **After step 4:** Remove `EUM_PROXY_URL` from Fly.io secrets → app falls back to direct EUM URL (still whitelisted until step 6, `EUM_API_ID`/`EUM_API_KEY` still in Fly.io secrets)
- **After step 6:** Re-add Fly.io IP to EUM whitelist, re-add `EUM_API_ID`/`EUM_API_KEY` to Fly.io secrets, remove `EUM_PROXY_URL`

## Files Changed

| File | Change |
|------|--------|
| `web/src/lib/eum/client.ts` | Read `EUM_PROXY_URL` env var, skip auth params when proxied, add `getProxyHeaders()` helper, attach header to 3 fetch calls |
| `.env.example` | Add `EUM_PROXY_URL` and `EUM_PROXY_KEY` placeholders under Frontend Settings |

## Out of Scope

- TLS on the proxy (can be added later with Let's Encrypt if desired)
- Migrating the web app off Fly.io
- Changes to the crawler, minutes search, or any other component
- CI/CD pipeline changes
