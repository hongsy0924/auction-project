# Infrastructure Guide: How Our Server Setup Works

A plain-language guide to the infrastructure behind this project. Written for someone who has never managed a server before.

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [What Is a Server?](#what-is-a-server)
3. [Our Two Servers](#our-two-servers)
4. [What Is nginx?](#what-is-nginx)
5. [What Is a Reverse Proxy?](#what-is-a-reverse-proxy)
6. [Why We Built the EUM Proxy](#why-we-built-the-eum-proxy)
7. [IP Addresses and Whitelisting](#ip-addresses-and-whitelisting)
8. [Ports](#ports)
9. [Firewall and ACG](#firewall-and-acg)
10. [SSH: How You Connect to the Server](#ssh-how-you-connect-to-the-server)
11. [Environment Variables and Secrets](#environment-variables-and-secrets)
12. [DNS: How Names Become Addresses](#dns-how-names-become-addresses)
13. [Our Complete Architecture](#our-complete-architecture)
14. [Common Tasks Cheat Sheet](#common-tasks-cheat-sheet)

---

## The Big Picture

Imagine you have a restaurant (your web app). Customers (users) come in through the front door (Fly.io). The kitchen needs ingredients from a supplier (EUM API), but the supplier only delivers to a specific address that doesn't change. Your restaurant's front door keeps moving (Fly.io's changing IPs), so the supplier won't deliver there.

Solution: you set up a permanent mailbox (nginx proxy) at a fixed address (NCP VM) that the supplier trusts. The restaurant calls the mailbox, the mailbox picks up the delivery from the supplier and passes it back.

That's exactly what we built.

---

## What Is a Server?

A **server** is just a computer that's always on, always connected to the internet, and runs programs that other computers can talk to.

Your laptop is a computer you sit in front of. A server is a computer that sits in a data center somewhere, and you control it remotely. It has no screen, no keyboard — you talk to it over the internet.

**Why not just use your laptop?**
- Your laptop sleeps, loses Wi-Fi, gets restarted
- Your home IP address changes
- A server stays on 24/7 with a fixed address

---

## Our Two Servers

We use two different services to run two different things:

### Fly.io — the web app

| | |
|---|---|
| **What it runs** | The Next.js website (the thing users see in their browser) |
| **Where it is** | Tokyo, Japan (`nrt` region) |
| **Cost** | Free tier |
| **App name** | `applemango` |
| **URL** | `https://applemango.fly.dev` |
| **Type** | PaaS (Platform as a Service) — you give it your code, it handles the rest |

Fly.io is like renting a food truck. You provide the recipe (your code), and Fly.io provides the truck, the gas, and the parking spot. You don't worry about the engine.

**The catch:** Fly.io's food truck moves around. Its **outbound IP address** (the return address on mail it sends) can change at any time. This is fine for most things, but some services (like EUM) need a fixed return address.

### NCP (Naver Cloud Platform) — the VM

| | |
|---|---|
| **What it runs** | The Python crawler + the nginx proxy |
| **Where it is** | Korea |
| **IP address** | `175.106.98.80` (fixed, never changes) |
| **Spec** | 1 vCPU, 1GB RAM, 10GB storage (Micro Server) |
| **OS** | Ubuntu 24.04 |
| **Type** | IaaS (Infrastructure as a Service) — you rent a bare computer and set it up yourself |

NCP is like renting an empty kitchen. You get the space and utilities, but you install the stove, fridge, and everything else yourself. You have full control, but also full responsibility.

**The key advantage:** It has a **static IP** (`175.106.98.80`). This address never changes. That's why we put the EUM proxy here.

### PaaS vs IaaS — what's the difference?

| | PaaS (Fly.io) | IaaS (NCP VM) |
|---|---|---|
| You manage | Your code | Everything: OS, software, security, updates |
| They manage | Server, OS, networking, scaling | Hardware, network, power |
| Like | Renting a food truck | Renting an empty kitchen |
| Good for | Web apps, APIs | Custom setups, fixed IPs, crawlers |

---

## What Is nginx?

**nginx** (pronounced "engine-x") is a program that handles web traffic. Think of it as a receptionist at the front desk of a building.

When someone sends a request to your server, nginx is the first thing that receives it. It then decides what to do:
- "This person wants the health check? I'll answer that myself." (static response)
- "This person wants EUM data? Let me forward that to the EUM API." (reverse proxy)
- "This person doesn't have the right key? Go away." (access control)

nginx is extremely lightweight (~2MB of RAM) and can handle thousands of requests per second. It's one of the most widely used programs on the internet.

**Where it lives:** On our NCP VM, installed via `apt install nginx`.

**Its config file:** `/etc/nginx/sites-available/eum-proxy` — this is where we define the rules for what nginx does with each request.

---

## What Is a Reverse Proxy?

A **proxy** is a middleman. A **reverse proxy** is a specific type of middleman that sits in front of a server and forwards requests to it.

```
Without proxy:
  Your App ──────────────────→ EUM API
  (Fly.io)                     (eum.go.kr)
  "Hi, I'm from IP 66.241.124.65"
  EUM: "I don't recognize that IP. Rejected."

With proxy:
  Your App ──→ nginx Proxy ──→ EUM API
  (Fly.io)     (NCP VM)        (eum.go.kr)
               "Hi, I'm from IP 175.106.98.80"
               EUM: "That IP is whitelisted. Here's your data."
```

The EUM API only sees the proxy's IP address, not the original caller's. Since the proxy has a fixed IP, EUM trusts it.

**Analogy:** You want to order food from a restaurant that only delivers to certain addresses. Your friend (the proxy) lives at one of those addresses. You call your friend, your friend orders the food, receives it, and passes it to you.

---

## Why We Built the EUM Proxy

The **EUM API** (토지이음, `api.eum.go.kr`) provides government land data — notices, permits, and restrictions. It's what powers the 투자시그널 tab.

EUM requires **IP whitelisting**: only pre-approved IP addresses can use the API. This is a security measure — they don't want random people scraping government data.

**The problem:** Our web app runs on Fly.io, which uses shared infrastructure. The outbound IP can change at any time (Fly.io might move your app to a different server). When the IP changes, EUM blocks the requests, and the 투자시그널 tab breaks.

**The solution:** We put a proxy on the NCP VM (fixed IP `175.106.98.80`). We told EUM to whitelist this IP. Now, even if Fly.io's IP changes, the proxy's IP stays the same.

**Bonus security:** The proxy also **injects the EUM API credentials** (the `id` and `key` parameters). This means:
- The credentials only exist on the NCP VM (in `/etc/nginx/secrets/`)
- They never travel unencrypted between Fly.io and NCP
- The web app doesn't need to know the EUM credentials at all

---

## IP Addresses and Whitelisting

### What is an IP address?

Every device on the internet has an address, like a house number on a street. For example:
- `175.106.98.80` — our NCP VM
- `66.241.124.65` — one of Fly.io's addresses (can change)
- `api.eum.go.kr` — a human-readable name that maps to an IP (see DNS section)

### Static vs Dynamic IP

| | Static IP | Dynamic IP |
|---|---|---|
| Changes? | Never | Can change anytime |
| Who has it? | Servers, VMs (like NCP) | Home internet, PaaS (like Fly.io) |
| Good for | Whitelisting, trusted access | General browsing |

### What is IP whitelisting?

IP whitelisting means "only allow requests from these specific IP addresses." It's like a VIP list at a club — if your name (IP) isn't on the list, you don't get in.

EUM maintains a whitelist. We asked them to add `175.106.98.80` (our NCP VM). Now any request from that IP is allowed.

---

## Ports

A **port** is like an apartment number in a building. The IP address is the building's street address; the port says which apartment to go to.

A single server can run many programs, each listening on a different port:

| Port | What's there (on our NCP VM) |
|------|------------------------------|
| 22 | SSH (remote access) |
| 8080 | nginx (our EUM proxy) |

When you visit `http://175.106.98.80:8080/health`, you're saying:
- Go to building `175.106.98.80` (the NCP VM)
- Knock on apartment `8080` (where nginx is listening)
- Ask for `/health` (the specific page)

Common well-known ports:
- **80** — HTTP (regular web traffic)
- **443** — HTTPS (encrypted web traffic)
- **22** — SSH (remote server access)
- **3000** — often used for development servers (like Next.js)

---

## Firewall and ACG

### What is a firewall?

A firewall is a security guard at the building entrance. It decides who can come in and who can't, based on rules you define.

There are two types:
- **Software firewall** (like `ufw` on Linux) — runs on the server itself
- **Cloud firewall** (like NCP's ACG) — runs at the network level, before traffic even reaches your server

### What is ACG?

**ACG (Access Control Group)** is NCP's cloud firewall. It's a set of rules that say:
- "Allow TCP traffic on port 22 from anywhere" → lets you SSH in
- "Allow TCP traffic on port 8080 from anywhere" → lets the proxy receive requests

**Inbound rules** = who can send traffic TO your server
**Outbound rules** = who your server can send traffic TO

When you added the inbound rule for port 8080, you told NCP's firewall: "Let anyone on the internet connect to port 8080 on my server." Without that rule, nginx was running and ready, but the firewall was blocking all traffic before it could reach nginx.

---

## SSH: How You Connect to the Server

**SSH (Secure Shell)** is how you remotely control a server. It's like a secure phone call to the server where you can type commands.

```bash
ssh root@175.106.98.80
```

This means: "Connect to the server at `175.106.98.80` as the user `root`."

- **`root`** — the superuser account with full access to everything on the server
- **`175.106.98.80`** — the server's IP address
- You authenticate with a password or an SSH key (a file on your computer)

Once connected, you're typing commands directly on the server. When you type `ls`, you see the server's files, not your laptop's.

**Important:** Always be careful when logged in as `root`. You have unlimited power — you can accidentally delete everything.

---

## Environment Variables and Secrets

### What are environment variables?

Environment variables are settings that a program reads from its environment (the server it's running on), rather than from its code. Think of them as sticky notes on the wall of the kitchen — the recipe (code) says "use the API key from the sticky note," not "use THIS specific API key."

```
# In code (bad — key is hardcoded):
const API_KEY = "abc123";

# In code (good — reads from environment):
const API_KEY = process.env.API_KEY;
```

**Why?** Because code gets committed to git and shared. Secrets should not be in git.

### Where secrets live in our setup

| Secret | Where it's stored | How it gets there |
|--------|-------------------|-------------------|
| `EUM_PROXY_KEY` | Fly.io secrets + NCP nginx config | `fly secrets set` + manual file on VM |
| `EUM_API_ID`, `EUM_API_KEY` | NCP nginx config only | Manual file on VM (`/etc/nginx/secrets/`) |
| `GEMINI_API_KEY` | Fly.io secrets | `fly secrets set` |
| `JWT_SECRET` | Fly.io secrets | `fly secrets set` |

Fly.io secrets are set with:
```bash
fly secrets set KEY="value"
```
They're encrypted and injected into your app as environment variables at runtime.

---

## DNS: How Names Become Addresses

When you type `api.eum.go.kr` in a browser, your computer doesn't know where that is. It asks a **DNS server** (like a phone book) to look up the IP address.

```
You: "What's the IP for api.eum.go.kr?"
DNS: "It's 211.252.x.x"
You: "Thanks!" *connects to 211.252.x.x*
```

In our nginx config, we have:
```nginx
resolver 127.0.0.53 valid=300s;
```

This tells nginx: "When you need to look up a domain name, ask the DNS server at `127.0.0.53` (the VM's local DNS resolver). Cache the answer for 300 seconds."

We need this because nginx uses the domain name `api.eum.go.kr` in the proxy_pass directive, and it needs to know the actual IP to connect to.

---

## Our Complete Architecture

Here's everything together:

```
                    THE INTERNET
                         |
        ┌────────────────┼────────────────┐
        |                |                |
   [Users/Browser]  [EUM API]     [CLIK/Gemini/etc]
        |           eum.go.kr      (API key auth)
        |                |                |
        ▼                |                |
  ┌───────────┐          |                |
  │  Fly.io   │          |                |
  │  (Tokyo)  │          |                |
  │           │          |                |
  │ Next.js   │──────────┼────────────────┘
  │ Web App   │          |          (direct calls, no proxy needed)
  │           │          |
  │ SQLite DBs│          |
  └─────┬─────┘          |
        │                |
        │ EUM requests   |
        │ only           |
        ▼                |
  ┌───────────┐          |
  │  NCP VM   │          |
  │  (Korea)  │          |
  │           │          |
  │ nginx     │──────────┘
  │ :8080     │    (forwards to eum.go.kr with credentials)
  │           │
  │ Crawler   │    (runs daily at 5 AM, collects auction data)
  │ (Python)  │
  └───────────┘
  175.106.98.80
  (static IP, whitelisted with EUM)
```

### Request flow for 투자시그널 tab:

1. User opens the 투자시그널 tab in their browser
2. Browser requests `https://applemango.fly.dev/api/signal-top`
3. Fly.io's Next.js app needs EUM data for scoring
4. Next.js sends request to `http://175.106.98.80:8080/eum/arMapList?areaCd=...`
   - Includes `X-Proxy-Key` header for authentication
   - Does NOT include EUM credentials (proxy handles that)
5. nginx on NCP VM receives the request
   - Checks the proxy key → valid
   - Injects EUM `id` and `key` into the query string
   - Forwards to `https://api.eum.go.kr/web/Rest/OP/arMapList?areaCd=...&id=...&key=...`
6. EUM API sees the request from IP `175.106.98.80` (whitelisted) → returns data
7. nginx passes the response back to Fly.io
8. Next.js processes the data, calculates scores, returns to browser

### What runs where:

| Component | Server | Purpose |
|-----------|--------|---------|
| Next.js web app | Fly.io | Serves the website, API routes, scoring |
| SQLite databases | Fly.io (persistent volume) | Auction data, cache |
| nginx proxy | NCP VM | Forwards EUM API requests with fixed IP |
| Python crawler | NCP VM | Collects auction data daily |

---

## Common Tasks Cheat Sheet

### Check if the proxy is running
```bash
curl http://175.106.98.80:8080/health
# Should return: ok
```

### SSH into the NCP VM
```bash
ssh root@175.106.98.80
```

### Check nginx status (on the VM)
```bash
systemctl status nginx
```

### Restart nginx (on the VM)
```bash
systemctl restart nginx
```

### View nginx error logs (on the VM)
```bash
tail -20 /var/log/nginx/eum-proxy-error.log
```

### View nginx access logs (on the VM)
```bash
tail -20 /var/log/nginx/eum-proxy-access.log
```

### Test nginx config syntax (on the VM)
```bash
nginx -t
```

### Edit nginx config (on the VM)
```bash
nano /etc/nginx/sites-available/eum-proxy
# After editing:
nginx -t && systemctl reload nginx
```

### Set Fly.io secrets
```bash
cd web
fly secrets set KEY="value"
```

### Deploy to Fly.io
```bash
make deploy
```

### Check what's running on a port (on the VM)
```bash
ss -tlnp | grep 8080
```
