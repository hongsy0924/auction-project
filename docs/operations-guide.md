# Operations & Domain Guide: Running and Understanding the Service

A plain-language guide to operating this service day-to-day, understanding the domain it operates in, and troubleshooting when things go wrong.

---

## Table of Contents

### Part 1: Domain Knowledge
1. [Korean Court Auctions 101](#korean-court-auctions-101)
2. [Government Compensation: The Investment Thesis](#government-compensation-the-investment-thesis)
3. [Key Korean Terms Glossary](#key-korean-terms-glossary)

### Part 2: Daily Operations
4. [The Daily Routine](#the-daily-routine)
5. [Running the Crawler](#running-the-crawler)
6. [Triggering Score Precomputation](#triggering-score-precomputation)
7. [Deploying Updates](#deploying-updates)
8. [Managing Users](#managing-users)
9. [Checking Service Health](#checking-service-health)

### Part 3: Troubleshooting
10. [When Things Break: Decision Tree](#when-things-break-decision-tree)
11. [Common Problems and Fixes](#common-problems-and-fixes)
12. [Reading Logs](#reading-logs)

### Part 4: Maintenance
13. [Updating API Keys](#updating-api-keys)
14. [Database Maintenance](#database-maintenance)
15. [Updating Dependencies](#updating-dependencies)
16. [Backup and Recovery](#backup-and-recovery)
17. [Cost Management](#cost-management)

---

# Part 1: Domain Knowledge

## Korean Court Auctions 101

### What is a court auction (경매)?

When someone can't pay their mortgage or debts, the court takes their property and sells it at auction to pay off the debt. These auctions happen regularly at courts across Korea.

**Why auctions are interesting for investors:** Properties at auction are typically sold below market value. The minimum bid often starts at 70-80% of the appraised value, and if nobody bids (유찰), it drops further — sometimes to 50% or less.

### How an auction progresses

```
Property owner defaults on loan
         │
         ▼
Court appraises the property (감정평가)
  → Sets appraised value (감정평가액)
  → Sets minimum bid (최저매각가격), usually 70-80% of appraised value
         │
         ▼
First auction date (매각기일)
  → If someone bids ≥ minimum → Sold (매각)
  → If nobody bids → Failed (유찰)
         │
         ▼ (if 유찰)
Re-listed at lower price (typically 80% of previous minimum)
  → 1st 유찰: min bid drops to ~56% of appraised value
  → 2nd 유찰: drops to ~45%
  → 3rd 유찰: drops to ~36%
  → Each failure = lower price = bigger potential bargain
```

### What our app tracks

The court publishes upcoming auctions (매각기일 within next 14 days). Our crawler grabs these listings every day and adds extra information from government databases. The app then helps you find the ones that might be involved in government compensation — which would make them worth much more than their auction price.

---

## Government Compensation: The Investment Thesis

### The basic idea

The Korean government regularly builds infrastructure — roads, parks, schools, subway lines. When a planned facility passes through privately owned land, the government must **compensate (보상)** the landowner at fair market value.

**The opportunity:** If you buy land at auction for 50% of its value, and the government later compensates you at 100% of its value, you double your money.

**The challenge:** How do you know which properties will be compensated? That's what this app does — it checks government databases for signals.

### The project lifecycle

Government projects go through stages. The further along, the more certain compensation becomes:

```
Stage 0: Nothing
  No government plans found for this area.
  Score: 0.0

         ▼

Stage 1: 결정고시 (Decision Notice)
  The government has ANNOUNCED a plan (e.g., "We plan to build a road
  through 역삼동"). This is public notice but no money has been committed.
  Score: 0.3 — Early signal, uncertain

         ▼

Stage 2: 실시계획 (Implementation Plan)
  The government has approved a DETAILED PLAN with drawings, budgets,
  and timelines. This is more concrete.
  Score: 0.5 — Getting serious

         ▼

Stage 3: 사업인정 (Project Recognition)
  The project is OFFICIALLY RECOGNIZED. The government has legal authority
  to acquire land. Compensation negotiations may begin.
  Score: 0.8 — Very likely

         ▼

Stage 4: 보상 (Compensation)
  Active compensation is happening. The government is PAYING landowners.
  Score: 1.0 — It's happening right now
```

### What is 도시계획시설 (Urban Planning Facilities)?

Urban planning facilities are things like roads, parks, schools, railways, and parking lots that the government plans to build. When such a facility is designated, it creates a zone on the map. Properties that fall within this zone may eventually be subject to compensation.

### How properties relate to facilities: 포함, 저촉, 접합

When a planned facility zone overlaps with a property, the overlap can be:

| Korean | English | What it means | Visual |
|--------|---------|--------------|--------|
| 포함 | Included | The property is COMPLETELY INSIDE the facility zone | `[===PROPERTY===]` inside `[=====ZONE=====]` |
| 저촉 | Conflicting | The property PARTIALLY OVERLAPS the zone | `[==PROPERTY==]` overlapping `[==ZONE==]` |
| 접합 | Adjacent | The property TOUCHES the zone boundary | `[PROPERTY][ZONE]` side by side |

**포함 is the best signal** — if the entire property is inside the zone, it will almost certainly be acquired when the facility is built.

### What is 공시지가 (Official Land Price)?

Every year, the Korean government assesses the value of all land parcels and publishes the official price per square meter. This is called 공시지가.

**Why it matters:** We compare the auction's minimum bid against the official land value. If you can buy land at auction for 50% of what the government says it's worth, that's a great deal — especially if compensation will be based on the official value.

**최저가/공시지가비율** = minimum bid price ÷ (official price per sqm × area). A ratio of 0.45 means you're buying at 45% of official value.

### What is PNU?

PNU (Parcel Number Unit) is Korea's standard land parcel ID system. Every piece of land in Korea has a unique PNU code (19 digits).

```
PNU: 1168010100 1 0123 0000
     ├────────┤ │ ├──┤ ├──┤
     행정구역코드  대/산 본번  부번
     (area code)
```

The first 5 digits identify the 시군구 (city/district). We use this to group properties by area when fetching government data.

---

## Key Korean Terms Glossary

| Korean | Pronunciation | English | Context |
|--------|-------------|---------|---------|
| 경매 | gyeongmae | Auction | Court-ordered property sale |
| 감정평가액 | gamjeong pyeongga-aek | Appraised value | Court's assessed property value |
| 최저매각가격 | choejeo maegak gagyeok | Minimum bid price | Lowest accepted bid |
| 유찰 | yuchal | Failed auction | No bidders, re-listed lower |
| 매각기일 | maegak gi-il | Sale date | When the auction happens |
| 보상 | bosang | Compensation | Government pays for land |
| 고시 | gosi | Government notice | Official announcement |
| 도시계획시설 | dosi gyehoek siseol | Urban planning facility | Government infrastructure plans |
| 포함 | poham | Included/contained | Fully inside facility zone |
| 저촉 | jeochok | Conflicting/overlapping | Partially inside zone |
| 접합 | jeophap | Adjacent/adjoining | Touching zone boundary |
| 공시지가 | gongsi jiga | Official land price | Government-assessed price/sqm |
| 지목 | jimok | Land category | Type of land (대, 답, 전, etc.) |
| 사건번호 | sageon beonho | Case number | Unique auction case ID |
| 시군구 | sigungu | City/district | Administrative area |
| 동 | dong | Neighborhood | Smallest administrative unit |
| 결정고시 | gyeoljeong gosi | Decision notice | Stage 1: plan announced |
| 실시계획 | silsi gyehoek | Implementation plan | Stage 2: detailed plan approved |
| 사업인정 | sa-eop injeong | Project recognition | Stage 3: legally authorized |
| 회의록 | hoe-uirok | Meeting minutes | Council meeting transcript |
| 인허가 | inheo-ga | Permit | Development permit |
| 토지이용규제 | toji iyong gyuje | Land use regulation | What you can/can't build |

---

# Part 2: Daily Operations

## The Daily Routine

Here's what happens each day and what you need to do:

### Automated (no action needed)

| Time | What happens | Where |
|------|-------------|-------|
| 5:00 AM | Crawler runs (cron on NCP VM) | NCP VM |
| Always | Web app serves users | Fly.io |
| Always | Cache auto-expires old entries | Fly.io |

### Manual (when you decide to)

| Task | How often | Command |
|------|-----------|---------|
| Trigger precompute | After each crawl, or when you want fresh scores | See [Triggering Score Precomputation](#triggering-score-precomputation) |
| Deploy code updates | When you push new code | `make deploy` |
| Check health | Whenever you want peace of mind | See [Checking Service Health](#checking-service-health) |

### Typical workflow after code changes

```
1. Make code changes locally
2. Test: make dev (run locally at localhost:3000)
3. Verify: make test && make typecheck
4. Commit to git
5. Deploy: make deploy
6. Verify: check the live site
```

---

## Running the Crawler

The crawler collects auction listings from the court website. It runs daily at 5 AM via cron on the NCP VM.

### Check if the crawler is set up as a cron job

```bash
ssh root@175.106.98.80
crontab -l
```

If you don't see a crawl entry, you need to add one:

```bash
crontab -e
# Add this line:
0 5 * * * cd /path/to/auction-project && make crawl >> /var/log/crawler.log 2>&1
```

### Run the crawler manually

```bash
# From the project root on the NCP VM
make crawl
```

This runs three steps:
1. **Crawl** — Fetch auction listings (takes 5-15 minutes depending on volume)
2. **Enrich** — Add land use and price data from VWorld API
3. **Clean** — Translate columns to Korean

### After the crawler finishes

The database file `web/database/auction_data.db` is updated. If the app runs on Fly.io, you need to get the updated database there. Options:

1. **Commit and deploy** — `git add web/database/auction_data.db && git commit && make deploy`
2. **SCP directly** — Copy the file to the Fly.io volume (advanced)

### What if the crawler fails?

Check the logs:
```bash
# On the NCP VM
cat /var/log/crawler.log    # if using cron
# or look in the crawler's log directory
ls crawler/data/logs/
```

Common reasons:
- **Court website changed layout** — Playwright selectors need updating
- **IP blocked** — Too many requests. Wait 2 hours and try again
- **VWorld API rate limit** — Set `SKIP_VWORLD_API=true` to skip enrichment
- **Network timeout** — Just retry: `make crawl`

---

## Triggering Score Precomputation

Precompute calculates investment scores for ALL properties. Run it after the crawler updates the database.

### How to trigger

```bash
# Replace <SECRET> with your PRECOMPUTE_SECRET value
curl -X POST \
  -H "Authorization: Bearer <SECRET>" \
  https://applemango.fly.dev/api/signal-top/precompute
```

You should get back:
```json
{"status": "started", "batchId": "20260319_050000"}
```

The job runs in the background. It takes **2-10 minutes** depending on how many properties there are and how many API calls need to be made (cache misses).

### How to check if precompute finished

Visit the 투자시그널 tab — if it shows data with recent timestamps, it worked. Or check Fly.io logs:

```bash
cd web && fly logs | grep Precompute
```

### When to run precompute

- **After every crawler run** — new data needs scoring
- **After EUM IP whitelist changes** — scores may have been 0 due to API failures
- **Weekly, at minimum** — cache TTLs are 7 days; after that, data goes stale

---

## Deploying Updates

### Standard deploy

```bash
# From the project root
make deploy
```

This runs `flyctl deploy --remote-only`, which:
1. Sends your code to Fly.io's build servers
2. Builds a Docker image
3. Starts a new machine with the image
4. Switches traffic to the new machine
5. Stops the old machine

**Deploys take 2-5 minutes.** The site has a brief interruption (~10 seconds) during the switch.

### Checking deploy status

```bash
cd web && fly status
```

### Rolling back a bad deploy

If you deployed broken code:

```bash
# List recent deployments
cd web && fly releases

# Roll back to the previous release
fly deploy --image <previous-image-ref>
```

Or just fix the code and deploy again — often faster than rolling back.

### What NOT to forget

- **Database file:** If you updated `auction_data.db`, make sure it's included in the deploy
- **Environment variables:** If you added new env vars in code, set them on Fly.io first:
  ```bash
  fly secrets set NEW_VAR="value"
  ```
  Fly.io automatically restarts the app when you set secrets.

---

## Managing Users

### Adding a new user

Users are defined in the `VALID_USERS` Fly.io secret (a JSON array).

```bash
# First, generate a password hash
python3 -c "import hashlib; print(hashlib.sha256(b'their-password').hexdigest())"

# Then update the secret (include ALL users, not just the new one)
fly secrets set VALID_USERS='[{"username":"admin","passwordHash":"abc123...","role":"admin"},{"username":"newuser","passwordHash":"def456...","role":"viewer"}]'
```

### Changing a password

Same process — generate a new hash, update VALID_USERS with the new hash.

### Current auth limitations

- No self-service password change (must update env var manually)
- No role-based access control (all users see everything)
- JWT tokens expire after 8 hours (users must re-login)
- No multi-factor authentication

---

## Checking Service Health

### Quick health checks

| What to check | Command | Expected |
|--------------|---------|----------|
| Web app is up | `curl -s https://applemango.fly.dev` | HTML page |
| EUM proxy is up | `curl -s http://175.106.98.80:8080/health` | `ok` |
| Fly.io machine status | `cd web && fly status` | Running |
| NCP VM is up | `ssh root@175.106.98.80 'uptime'` | Uptime output |
| nginx is running | `ssh root@175.106.98.80 'systemctl status nginx'` | active (running) |

### Deeper checks

```bash
# Check Fly.io logs for errors
cd web && fly logs --no-tail | grep -i error | tail -20

# Check nginx proxy logs
ssh root@175.106.98.80 'tail -20 /var/log/nginx/eum-proxy-error.log'

# Check if auction data is recent
curl -s -H "Cookie: authToken=<your-jwt>" \
  https://applemango.fly.dev/api/auction-list?page=1&per_page=1 | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'], 'items')"

# Check if precomputed scores exist
curl -s -H "Cookie: authToken=<your-jwt>" \
  https://applemango.fly.dev/api/signal-top?page=1&per_page=1 | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'], 'scored items')"
```

---

# Part 3: Troubleshooting

## When Things Break: Decision Tree

```
Something isn't working
│
├── Can you open the website at all?
│   ├── NO → Fly.io is down
│   │   → Run: cd web && fly status
│   │   → Check: fly.io/dashboard for incidents
│   │   → Try: fly apps restart applemango
│   │
│   └── YES → The site loads but...
│       │
│       ├── Can't log in?
│       │   → Check VALID_USERS secret: fly secrets list
│       │   → Check JWT_SECRET is set
│       │
│       ├── 경매물건 tab shows no data?
│       │   → Database is empty or missing
│       │   → Check: fly ssh console, then ls -la /data/
│       │   → The crawler might not have run
│       │
│       ├── 투자시그널 tab shows no data?
│       │   → Precompute hasn't been run
│       │   → Or precompute failed (check fly logs)
│       │   → Trigger: curl -X POST ... /api/signal-top/precompute
│       │
│       ├── 투자시그널 shows scores but all gosi_stage = 0?
│       │   → EUM API is failing
│       │   → Check proxy: curl http://175.106.98.80:8080/health
│       │   → Check IP whitelist with EUM
│       │   → Check EUM_PROXY_URL and EUM_PROXY_KEY in fly secrets
│       │
│       └── 회의록 search returns nothing?
│           → CLIK API might be down
│           → Check CLIK_API_KEY is valid
│           → Try a simple search manually to test
```

---

## Common Problems and Fixes

### Problem: "502 Bad Gateway" on the website

**Cause:** The Fly.io machine crashed or is starting up.

**Fix:**
```bash
cd web && fly status              # Check machine state
fly logs --no-tail | tail -30     # Check what happened
fly apps restart applemango       # Force restart
```

### Problem: Crawler says "차단 감지됨" (block detected)

**Cause:** The court website blocked your IP because of too many requests.

**Fix:** Wait 2 hours and try again. The crawler has built-in retry logic (waits 120 seconds per blocked page), but if many pages are blocked, it's better to wait and retry from scratch.

### Problem: EUM proxy returns 403

**Cause:** Wrong or missing proxy key.

**Fix:**
```bash
# Test with your key
curl -H "X-Proxy-Key: YOUR_KEY" http://175.106.98.80:8080/eum/arMapList?areaCd=11680

# If 403 persists, check the key on the VM
ssh root@175.106.98.80 'cat /etc/nginx/secrets/eum-proxy-key.conf'

# Make sure it matches what Fly.io has
fly secrets list  # Look for EUM_PROXY_KEY
```

### Problem: EUM proxy returns 502

**Cause:** nginx can't reach `api.eum.go.kr`.

**Fix:**
```bash
# SSH to VM and test direct connection
ssh root@175.106.98.80
curl -s "https://api.eum.go.kr/web/Rest/OP/arMapList?id=YOUR_ID&key=YOUR_KEY&areaCd=11680"

# If that works, check nginx error log
tail -20 /var/log/nginx/eum-proxy-error.log

# Common cause: "no resolver" → make sure nginx config has resolver directive
```

### Problem: EUM returns ERR-002

**Cause:** Your IP is not whitelisted with EUM.

**Fix:** Contact EUM (토지이음) to verify that `175.106.98.80` is whitelisted. IP whitelist requests can take 1-3 business days.

### Problem: Precompute runs but all scores are 0

**Cause:** All external API calls are failing (EUM, CLIK, LURIS).

**Fix:**
```bash
# Check Fly.io logs during precompute
fly logs | grep -E "(EUM|CLIK|LURIS|error)" | tail -30

# Verify API keys are set
fly secrets list
# Should show: CLIK_API_KEY, EUM_PROXY_URL, EUM_PROXY_KEY, LURIS_API_KEY, GEMINI_API_KEY
```

### Problem: "DB 파일이 존재하지 않습니다"

**Cause:** The SQLite database file is missing from the expected path.

**Fix:**
```bash
# Check if the file exists on Fly.io
fly ssh console
ls -la /data/
# Should see auction_data.db and minutes_cache.db

# If missing, copy from git
cp /app/database/auction_data.db /data/
```

---

## Reading Logs

### Where logs live

| Log | Location | What it shows |
|-----|---------|--------------|
| Fly.io app logs | `fly logs` (from web/ directory) | All Next.js console output |
| nginx access log | `/var/log/nginx/eum-proxy-access.log` (NCP VM) | Every request to the proxy |
| nginx error log | `/var/log/nginx/eum-proxy-error.log` (NCP VM) | Proxy errors only |
| Crawler log | `crawler/data/logs/` or `/var/log/crawler.log` (NCP VM) | Crawl progress and errors |

### Reading Fly.io logs

```bash
# Live tail (watch in real-time)
cd web && fly logs

# Last 100 lines (no streaming)
fly logs --no-tail | tail -100

# Filter for errors
fly logs --no-tail | grep -i error

# Filter for precompute progress
fly logs --no-tail | grep Precompute
```

### What the log prefixes mean

| Prefix | Source |
|--------|--------|
| `[EUM]` | EUM API client (notices, permits, restrictions) |
| `[LURIS]` | LURIS API client (facilities) |
| `[Searcher]` | Minutes search hybrid engine |
| `[Precompute]` | Score precomputation job |
| `[API /...]` | API route handlers |

---

# Part 4: Maintenance

## Updating API Keys

API keys expire or get rotated. Here's how to update each one:

### Fly.io secrets (web app)

```bash
cd web
fly secrets set KEY_NAME="new-value"
# The app restarts automatically
```

| Secret | What it's for | How to get a new one |
|--------|-------------|---------------------|
| `CLIK_API_KEY` | Council minutes search | Apply at data.go.kr |
| `LURIS_API_KEY` | Urban plan facilities | Apply at data.go.kr |
| `GEMINI_API_KEY` | AI analysis | Google AI Studio |
| `EUM_PROXY_KEY` | NCP proxy auth | `openssl rand -hex 32` (update both Fly.io and NCP) |
| `EUM_PROXY_URL` | NCP proxy address | Only changes if VM IP changes |
| `JWT_SECRET` | User auth tokens | Any random string (changing it logs everyone out) |
| `PRECOMPUTE_SECRET` | Precompute endpoint auth | Any random string |

### NCP VM secrets (proxy)

```bash
ssh root@175.106.98.80

# Update proxy key (must match Fly.io's EUM_PROXY_KEY)
echo 'set $proxy_key "NEW_KEY_HERE";' > /etc/nginx/secrets/eum-proxy-key.conf

# Update EUM credentials
cat > /etc/nginx/secrets/eum-api-credentials.conf << 'EOF'
set $eum_id "NEW_ID";
set $eum_key "NEW_KEY";
EOF

# Reload nginx (no downtime)
nginx -t && systemctl reload nginx
```

### Crawler secrets (NCP VM)

```bash
ssh root@175.106.98.80
# Edit the crawler's .env file
nano /path/to/auction-project/crawler/.env
```

---

## Database Maintenance

### Cache cleanup

The cache database (`minutes_cache.db`) grows over time as API responses accumulate. Expired entries aren't automatically deleted — they're just ignored when their TTL expires.

To clean up manually:

```bash
# SSH into Fly.io
cd web && fly ssh console

# Open the cache database
sqlite3 /data/minutes_cache.db

# See table sizes
.tables
SELECT COUNT(*) FROM eum_notices;
SELECT COUNT(*) FROM search_cache;

# Delete expired entries (example for 7-day TTL)
DELETE FROM eum_notices WHERE cached_at < datetime('now', '-7 days');
DELETE FROM eum_permits WHERE cached_at < datetime('now', '-7 days');
DELETE FROM search_cache WHERE cached_at < datetime('now', '-1 day');

# Reclaim disk space
VACUUM;
.quit
```

### Checking database sizes

```bash
# On Fly.io
fly ssh console
ls -lh /data/
# auction_data.db  — typically 5-50 MB
# minutes_cache.db — typically 10-200 MB (grows with usage)
```

### If the database gets corrupted

SQLite databases can occasionally get corrupted (power loss, disk full).

```bash
# Check integrity
sqlite3 /data/auction_data.db "PRAGMA integrity_check;"
# Should return "ok"

# If corrupted, restore from the git copy
cp /app/database/auction_data.db /data/auction_data.db
```

---

## Updating Dependencies

### Frontend (Node.js)

```bash
cd web

# Check for outdated packages
npm outdated

# Update all (minor/patch versions)
npm update

# Update a specific package to latest major version
npm install next@latest react@latest react-dom@latest

# After updating, always:
make typecheck    # Make sure nothing broke
make test         # Run tests
make dev          # Test locally
```

### Backend (Python)

```bash
cd crawler

# Check for outdated packages
pip list --outdated

# Update a specific package
pip install --upgrade playwright

# After updating Playwright, install browsers
playwright install chromium

# After updating, always:
make lint         # Check code style
make typecheck    # Type check
make test         # Run tests
```

### When to update

- **Security patches:** Immediately (check `npm audit` and `pip audit`)
- **Minor versions:** Monthly (bug fixes, small improvements)
- **Major versions:** Quarterly, with careful testing (breaking changes possible)

---

## Backup and Recovery

### What to back up

| What | Where | How often | Why |
|------|-------|-----------|-----|
| `auction_data.db` | Fly.io `/data/` | Daily (before crawler runs) | Contains all auction data |
| `minutes_cache.db` | Fly.io `/data/` | Weekly | Contains cached API responses and scores |
| nginx secrets | NCP VM `/etc/nginx/secrets/` | After any change | Contains API keys |
| Fly.io secrets | Fly.io dashboard | After any change | Contains all env vars |

### How to back up databases

```bash
# Download from Fly.io to your local machine
cd web
fly ssh sftp get /data/auction_data.db ./backup-auction_data.db
fly ssh sftp get /data/minutes_cache.db ./backup-minutes_cache.db
```

### How to restore

```bash
# Upload to Fly.io
fly ssh sftp shell
put backup-auction_data.db /data/auction_data.db
put backup-minutes_cache.db /data/minutes_cache.db
exit

# Restart the app to pick up the restored database
fly apps restart applemango
```

---

## Cost Management

### Current costs

| Service | Cost | What for |
|---------|------|---------|
| Fly.io | Free | Web app hosting (free tier: 1 shared CPU, 256MB RAM) |
| NCP Micro Server | ~10,000-15,000 KRW/month | VM for crawler + proxy |
| VWorld API | Free | Land use data (rate-limited) |
| EUM API | Free | Government notices (IP-whitelisted) |
| CLIK API | Free | Council minutes |
| LURIS API | Free | Urban plan data |
| Gemini API | Free tier (limited) | AI analysis (may cost if heavy usage) |
| GitHub | Free | Code hosting, CI/CD |

### What could increase costs

- **Gemini API overuse:** Each AI analysis costs tokens. The cache prevents repeat calls, but many unique analyses could exceed the free tier
- **NCP VM upgrade:** If you ever need more RAM (current: 1GB), the next tier costs more
- **Fly.io scaling:** If traffic grows beyond the free tier limits

### How to keep costs down

- **Cache aggressively:** The 7/30-day TTLs prevent unnecessary API calls
- **Precompute in batches:** One precompute run caches scores for 7 days
- **Don't disable caching during development** — even in dev, hitting real APIs costs quota
- **Monitor Gemini usage:** Check Google AI Studio dashboard monthly
