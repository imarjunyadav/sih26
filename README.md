# CityLink — Mumbai Multimodal Journey Planner

CityLink is a React + Node.js application that plans multimodal journeys across Mumbai (Walk, Mumbai Local, Metro, BEST Bus) and provides an ONDC-protocol BAP (Buyer App) layer for Metro ticket booking via the ONDC network.

This repository originated from SIH 2026 Problem Statement PS-23. The ONDC BAP integration is registered under Taqneeki Pvt Ltd's identity (`mobility.taqneeki.in`).

---

## Table of Contents

1. [Architecture](#architecture)
2. [Repository Layout](#repository-layout)
3. [Getting Started (Local)](#getting-started-local)
4. [Environment Variables](#environment-variables)
5. [ONDC BAP Integration](#ondc-bap-integration)
6. [Deployment](#deployment)
7. [API Reference](#api-reference)
8. [Testing](#testing)
9. [Implementation Status and Handover Notes](#implementation-status-and-handover-notes)

---

## Architecture

```
Browser (React / Leaflet)
        │
        │  /api/*  /ondc/api/*  SSE
        ▼
Express Backend  (Node.js, port 8080)
        │
        ├── Journey Planner
        │     ├── Google Routes API    — walk, drive, transit (Google Transit)
        │     └── RailRadar API        — Mumbai Local train schedules
        │
        └── ONDC BAP (TRV11 v2.0.0)
              ├── Outbound: signed POST → ONDC Preprod Gateway / BPP
              └── Inbound:  BPP callbacks → POST /on_search, /on_select, …
                            (arrive at https://mobility.taqneeki.in/on_*)
```

The frontend is a Vite/React SPA served as static files by the same Express process. In production the Docker image contains a pre-built `frontend/dist/` and the Express server serves it.

---

## Repository Layout

```
.
├── backend/
│   └── src/
│       ├── server.js             — Express entry point
│       ├── config.js             — All env var reads (backend)
│       ├── api/
│       │   ├── journeys.js       — POST /api/routes
│       │   └── places.js         — GET /api/places/autocomplete, /details
│       ├── services/
│       │   └── journeyService.js — Multimodal routing logic
│       ├── providers/
│       │   ├── googleRoutes.js   — Google Routes API client
│       │   └── railRadar.js      — RailRadar API client (Mumbai Local)
│       ├── models/journey.js     — Journey/Leg data model
│       ├── data/
│       │   └── mumbaiLocalStations.js — Station catalog (coords + codes)
│       ├── utils/nearbyStations.js    — Haversine station lookup
│       └── ondc/                 — ONDC BAP implementation (see docs/ONDC.md)
│           ├── config.js         — ONDC env var reads
│           ├── router.js         — /ondc/* routes + SSE
│           ├── onboard.js        — Site verification + on_subscribe handler
│           ├── keygen.js         — Key generation utility (run once)
│           ├── core/             — Signing, verification, registry, HTTP client
│           ├── adapters/metro/   — TRV11 2.0.0 payload builders + callback handlers
│           ├── store/orderStore.js — In-memory transaction store
│           └── scripts/          — Onboarding helper scripts
├── frontend/
│   └── src/                      — React components + Vite config
├── e2e/smoke.spec.js             — Playwright smoke tests
├── .env.example                  — Complete env var reference (copy to .env)
├── docker-compose.yml            — Local development with Docker
├── Dockerfile                    — Multi-stage build (Node 22, production)
├── .github/workflows/deploy.yml  — GCP Cloud Run CI/CD (GCP-specific, see Deployment)
└── docs/
    └── ONDC.md                   — ONDC BAP implementation guide
```

---

## Getting Started (Local)

### Prerequisites

- Node.js 22+ (matches the Docker image)
- npm 10+
- A `.env` file with the required API keys (see [Environment Variables](#environment-variables))

### Option A — Node directly

```bash
# 1. Install dependencies for all workspaces
npm install

# 2. Copy and fill in environment variables
cp .env.example .env
# Edit .env — at minimum set GOOGLE_BACKEND_MAPS_KEY and RAILRADAR_API_KEY

# 3. Start backend (port 8080) and frontend dev server (port 5173) concurrently
npm run dev

# Or individually:
npm run dev:backend     # backend only
npm run dev:frontend    # frontend only (proxies /api → localhost:8080)
```

The frontend dev server at http://localhost:5173 proxies `/api` to the backend. In production the backend serves the built frontend directly.

### Option B — Docker Compose

```bash
cp .env.example .env
# Edit .env — fill in required keys

docker compose up --build
# App available at http://localhost:8080
```

### Build the frontend only

```bash
npm run build       # produces frontend/dist/
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in each value. In production, inject as environment variables — the app reads `process.env` directly and never crashes on missing optional values (it logs a warning instead).

### Application Keys

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_BACKEND_MAPS_KEY` | Yes | Server-side key for Google Routes API and Places API. Must have Routes API and Places API (New) enabled. Restrict to your server IP. |
| `GOOGLE_FRONTEND_MAPS_KEY` | Recommended | Browser-safe Google Maps JavaScript API key. Delivered to the browser via `GET /api/config/public`. If omitted, falls back to `GOOGLE_ANDROID_MAPS_KEY`, then to none (map tiles still work via Leaflet/OSM; only Maps JS SDK features are affected). |
| `GOOGLE_ANDROID_MAPS_KEY` | Optional | Fallback for the frontend Maps key. |
| `RAILRADAR_API_KEY` | Yes | RailRadar API key for Mumbai Local train schedules. Free tier: 50 req/day. Results are cached 22 h per station pair so one key handles moderate load. Get a key at railradar.in. |
| `MAPPLS_STATIC_KEY` | Optional | Not currently used in routing. Reserved for future Mappls integration. |
| `PORT` | Optional | HTTP port. Defaults to 8080. |
| `NODE_ENV` | Optional | `development` or `production`. Controls error detail in responses. |

### ONDC BAP Credentials

These belong to Taqneeki's registered ONDC identity. The registration is already complete — these values should come from your ONDC portal account and key generation records.

| Variable | Required | Description |
|---|---|---|
| `ONDC_SUBSCRIBER_ID` | Yes | Your ONDC subscriber ID — the domain name you registered. Value: `mobility.taqneeki.in` |
| `ONDC_SUBSCRIBER_URL` | Yes | Your public HTTPS base URL. BPPs send callbacks to `{ONDC_SUBSCRIBER_URL}/on_search` etc. Value: `https://mobility.taqneeki.in` |
| `ONDC_UNIQUE_KEY_ID` | Yes | UUID assigned when you registered your key pair with ONDC. Included in every outbound Authorization header. |
| `ONDC_SIGNING_PRIVATE_KEY` | Yes | Ed25519 private key, 64 bytes base64 (libsodium format). **Secret — never commit.** Used to sign every outbound ONDC request. |
| `ONDC_SIGNING_PUBLIC_KEY` | Yes | Ed25519 public key, 32 bytes base64. Not secret — it is registered in the ONDC registry and publicly verifiable. |
| `ONDC_ENCRYPTION_PRIVATE_KEY` | Yes | X25519 private key, 32 bytes base64. **Secret — never commit.** Used only during `/on_subscribe` challenge decryption (ONDC onboarding). |
| `ONDC_ENCRYPTION_PUBLIC_KEY` | Yes | X25519 public key, 44 bytes base64 (SPKI DER format, starts with `MCow`). Not secret. |
| `ONDC_SITE_VERIFICATION_SIGNED` | Yes | Base64 Ed25519 signature of the `unique_req_id` received from the ONDC portal during onboarding. Served at `GET /ondc-site-verification.html`. Prove domain ownership. |
| `ONDC_REGISTRY_URL` | Optional | ONDC registry. Default: `https://preprod.registry.ondc.org` (pre-production). Change to `https://registry.ondc.org` for production. |
| `ONDC_GATEWAY_URL` | Optional | ONDC gateway. Default: `https://preprod.gateway.ondc.org` (pre-production). Change for production. |
| `ONDC_ENV` | Optional | `uat` or `prod`. Controls which ONDC fixed encryption key is used during on_subscribe. Default: `uat`. |
| `ONDC_MOCK_PAYMENT` | Optional | Set to `true` to auto-generate a UUID as the payment transaction_id in `/confirm` requests. Useful for Pramaan testing without a real payment gateway. Default: `false`. |
| `ONDC_BUYER_FINDER_FEES_PCT` | Optional | BAP commission percentage sent in payment tags. Default: `1`. |
| `ONDC_COURT_JURISDICTION` | Optional | Jurisdiction for settlement terms. Default: `Mumbai`. |
| `ONDC_STATIC_TERMS_URL` | Optional | URL to your static terms document, included in `SETTLEMENT_TERMS` payment tags. |

### Secrets Management

**Private keys must never be in the repository, in Docker images, or in logs.**

For production deployments:
- Use a secrets manager (GCP Secret Manager, AWS Secrets Manager, HashiCorp Vault, or environment-level secrets in your hosting platform).
- Inject `ONDC_SIGNING_PRIVATE_KEY` and `ONDC_ENCRYPTION_PRIVATE_KEY` as runtime environment variables only.
- All other ONDC values are non-secret and can be set in your deployment config.

---

## ONDC BAP Integration

See [`docs/ONDC.md`](docs/ONDC.md) for the complete technical guide covering:
- The ONDC BAP request/callback flow (TRV11 v2.0.0)
- How Ed25519 signing and BLAKE-512 digests work in this implementation
- All ONDC API endpoints and their payload structures
- Postman testing guide with exact request bodies
- How to generate the `ONDC_SITE_VERIFICATION_SIGNED` value
- Registry lookup, auth middleware, and SSE event stream

### Quick reference — ONDC-related HTTP endpoints

```
# Served by this app (inbound from ONDC network):
GET  /ondc-site-verification.html   — domain ownership proof (ONDC registry fetches this)
POST /on_subscribe                  — onboarding challenge-response
POST /on_search                     — BPP sends search results
POST /on_select                     — BPP sends fare quote
POST /on_init                       — BPP acknowledges billing
POST /on_confirm                    — BPP issues ticket
POST /on_status                     — BPP sends status update
POST /on_support                    — BPP sends support data

# Called by the frontend (booking flow):
POST /ondc/api/search               — initiate Metro search
POST /ondc/api/select               — select a route/provider
POST /ondc/api/init                 — submit billing details
POST /ondc/api/confirm              — confirm booking after payment
POST /ondc/api/status               — poll order status
POST /ondc/api/support              — request support
GET  /ondc/api/order/:txnId         — get current order state
GET  /ondc/api/events/:txnId        — SSE stream for real-time booking updates
```

---

## Deployment

### Docker (any host)

The Dockerfile does a two-stage build: builds the frontend in stage 1, then copies the backend and `frontend/dist/` into a lean production image.

```bash
# Build image
docker build -t citylink:latest .

# Run (supply env vars via --env-file or -e flags)
docker run -p 8080:8080 --env-file .env citylink:latest

# Or with Docker Compose (uses docker-compose.yml):
docker compose up --build
```

The app listens on `PORT` (default 8080). It serves the React SPA and the API from the same process — no separate frontend server needed.

**Infrastructure requirements:**
- Any host that can run a Docker container and expose HTTPS on port 443
- A domain pointing to the host — this must be `mobility.taqneeki.in` (or whatever was registered with ONDC as `ONDC_SUBSCRIBER_URL`)
- HTTPS/TLS termination in front of the container (nginx, Caddy, a load balancer, etc.)
- The `ONDC_SUBSCRIBER_URL` must be reachable by the ONDC network for callbacks

### GCP Cloud Run (existing CI/CD)

`.github/workflows/deploy.yml` is a GitHub Actions workflow that builds the Docker image, pushes it to Google Artifact Registry, and deploys to Cloud Run in `asia-south1`. **This is GCP-specific and may not apply to Taqneeki's infrastructure.**

What it does:
1. Authenticates to GCP via Workload Identity Federation (no stored service account keys)
2. Builds and pushes the image to `asia-south1-docker.pkg.dev/<project>/citylink/app`
3. Runs `gcloud run deploy citylink` with ONDC env vars from GitHub Actions Variables and private keys from GCP Secret Manager

**If Taqneeki deploys on their own server:** adapt or replace `deploy.yml` with your own CI/CD. The Docker image and the env var contract are the same — only the GCP-specific deployment step differs.

**GCP resources specific to the original deployment (not portable):**
- GCP project ID `project-ed1c5c4b-97ab-4bba-98e`
- Workload Identity Pool `github-actions`
- GCP Secret Manager secrets `ondc-signing-private-key`, `ondc-encryption-private-key`
- HTTPS Load Balancer with static IP `136.68.71.124` → Serverless NEG → Cloud Run
- Google-managed SSL certificate for `mobility.taqneeki.in`

---

## API Reference

### Journey Planner

**`POST /api/routes`**

Plan a multimodal journey from origin to destination.

Request body:
```json
{
  "origin":      { "lat": 19.0760, "lng": 72.8777, "name": "CST" },
  "destination": { "lat": 19.1136, "lng": 72.8683, "name": "Andheri" },
  "departureTime": "2026-09-09T09:00:00+05:30"  // optional ISO 8601, defaults to now
}
```

Response:
```json
{
  "journeys": [
    {
      "id": "uuid",
      "category": "LOCAL_TRAIN",
      "departure": "2026-09-09T03:30:00.000Z",
      "arrival": "2026-09-09T04:15:00.000Z",
      "durationSecs": 2700,
      "totalWalkSecs": 600,
      "waitSecs": 300,
      "transferCount": 1,
      "fare": null,
      "legs": [
        {
          "mode": "WALK",
          "from": { "lat": 19.0760, "lng": 72.8777, "name": "CST" },
          "to":   { "lat": 18.9395, "lng": 72.8355, "name": "CSMT" },
          "departure": "...", "arrival": "...",
          "durationSecs": 300, "distanceMeters": 400,
          "isEstimated": false,
          "line": null, "headsign": null, "agency": null,
          "polyline": "_p~iF..."
        }
      ]
    }
  ],
  "warnings": [],
  "requestedAt": "2026-09-09T03:30:00.000Z"
}
```

Leg `mode` values: `WALK`, `LOCAL_TRAIN`, `METRO`, `BUS`, `CAR`, `BIKE`, `FERRY`, `TAXI`, `AUTO`

**`GET /api/places/autocomplete?q=Andheri&lat=19.0760&lng=72.8777`**

Place autocomplete using Google Places API. Returns up to 5 predictions.

**`GET /api/places/details?placeId=ChIJ...`**

Resolve a Google Place ID to coordinates.

**`GET /api/health`**

Returns service status and which external APIs have keys configured.

**`GET /api/config/public`**

Returns the Google Maps JavaScript API key for the browser (safe to serve publicly).

### ONDC BAP

See [`docs/ONDC.md`](docs/ONDC.md) for full ONDC API documentation.

---

## Testing

### Backend integration tests

Individual test scripts in `backend/src/`. Each requires the corresponding API key in `.env`.

```bash
npm run test:google    # tests Google Routes + Places API integration
npm run test:railradar # tests RailRadar API connectivity
npm run test:journey   # tests journey service with hardcoded Mumbai points
npm run test:api       # tests the /api/routes HTTP endpoint
```

### E2E smoke tests (Playwright)

```bash
# Start the app first (npm run dev or docker compose up)
npx playwright test e2e/smoke.spec.js
```

Smoke tests cover: page load, form rendering, search panel state, GPS button, health endpoint.

### ONDC API testing (Postman)

See [`docs/ONDC.md#postman-testing`](docs/ONDC.md#postman-testing) for step-by-step Postman instructions.

Short version:
```bash
# Health check
GET http://localhost:8080/api/health

# Site verification
GET http://localhost:8080/ondc-site-verification.html

# Start a search (returns txnId)
POST http://localhost:8080/ondc/api/search
{"from":{"gps":"19.0760,72.8777","name":"CST"},"to":{"gps":"19.1136,72.8683","name":"Andheri"}}

# Stream events
GET http://localhost:8080/ondc/api/events/<txnId>   (keep-alive / SSE)
```

A full end-to-end ONDC booking test (search → on_search callback → select → … → ticket) requires:
1. `ONDC_SUBSCRIBER_URL` reachable by the ONDC network (i.e. `mobility.taqneeki.in` must resolve to this server)
2. TLS on port 443
3. ONDC Preprod keys configured

---

## Implementation Status and Handover Notes

### What is fully implemented

- **Multimodal journey planner**: Walk + Mumbai Local (all 3 lines) + Metro + Bus + Drive. Route construction, ranking, category labels, IST time handling, track polylines on map.
- **ONDC BAP TRV11 v2.0.0**: All 6 actions (search/select/init/confirm/status/support) with correct payload structures, per-action SETTLEMENT_TERMS, BUYER_FINDER_FEES.
- **ONDC auth**: Ed25519 signing of outbound requests; BLAKE-512 body digest; registry-based verification of inbound BPP callbacks; Authorization header parsing.
- **ONDC callback routing**: Root-level routes (`POST /on_search` etc.) matching `bap_uri = https://mobility.taqneeki.in` so BPP callbacks arrive at the correct paths.
- **SSE event stream**: Real-time booking state pushed from backend to browser.
- **In-memory order store**: Tracks full transaction lifecycle with 2-hour TTL auto-expiry.
- **ONDC onboarding handlers**: Site verification HTML endpoint; `/on_subscribe` challenge decryption (X25519 + AES-128-ECB).
- **Docker**: Multi-stage production build; confirmed working.

### What is NOT yet implemented

- **Frontend Metro booking UI**: The ONDC booking API endpoints (`/ondc/api/*`) are complete on the backend, but there are no React components to call them. The frontend currently only shows the multimodal journey planner. A Metro ticket booking flow (search → pick route → enter billing → pay → QR ticket) needs to be built.
- **Payment integration**: The confirm step accepts a `paymentTransactionId` from the frontend, but no UPI/Razorpay/payment gateway integration exists. Set `ONDC_MOCK_PAYMENT=true` for Pramaan testing without real payments.
- **Persistent order store**: The current in-memory store loses state on restart and does not share state across multiple running instances. For production, replace `backend/src/ondc/store/orderStore.js` with a Redis or database-backed implementation.

### What Taqneeki needs to configure

1. **ONDC credentials** — Set these environment variables from your ONDC portal records:
   - `ONDC_UNIQUE_KEY_ID` — from your registration
   - `ONDC_SIGNING_PRIVATE_KEY` — your Ed25519 private key **(secret)**
   - `ONDC_SIGNING_PUBLIC_KEY` — your Ed25519 public key
   - `ONDC_ENCRYPTION_PRIVATE_KEY` — your X25519 private key **(secret)**
   - `ONDC_ENCRYPTION_PUBLIC_KEY` — your X25519 public key
   - `ONDC_SITE_VERIFICATION_SIGNED` — the base64 signature from onboarding

2. **Application API keys** — Set from your own API accounts:
   - `GOOGLE_BACKEND_MAPS_KEY` — server-side Google key
   - `GOOGLE_FRONTEND_MAPS_KEY` — browser-safe Google key
   - `RAILRADAR_API_KEY` — RailRadar account key

3. **Domain and TLS** — Deploy behind HTTPS with `mobility.taqneeki.in` pointing to your server. ONDC BPPs will POST callbacks to `https://mobility.taqneeki.in/on_search` etc. — the server must be reachable at that domain.

4. **Production ONDC** — When ready to move from pre-production to production, change:
   - `ONDC_REGISTRY_URL=https://registry.ondc.org`
   - `ONDC_GATEWAY_URL=https://gateway.ondc.org`
   - `ONDC_ENV=prod`
   - Complete the ONDC production certification process

### Generating `ONDC_SITE_VERIFICATION_SIGNED`

If you need to regenerate this value (e.g. the ONDC portal issued a new `unique_req_id`):

```bash
# Add ONDC_SIGNING_PRIVATE_KEY to .env first
node backend/src/ondc/scripts/sign-site-verification.js <unique_req_id_from_portal>
# Prints: ONDC_SITE_VERIFICATION_SIGNED=<base64>
# Set that value in your environment
```

### Verifying the setup

```bash
# 1. Health check (basic connectivity)
curl https://mobility.taqneeki.in/api/health

# 2. Site verification (ONDC registry checks this to confirm domain ownership)
curl https://mobility.taqneeki.in/ondc-site-verification.html
# Must return HTML with non-empty content="..." in the meta tag

# 3. Lookup your registration in the ONDC Preprod Registry
curl -s -X POST https://preprod.registry.ondc.org/v2.0/lookup \
  -H 'Content-Type: application/json' \
  -d '{"subscriber_id":"mobility.taqneeki.in","domain":"ONDC:TRV11"}'
# Should return your key registration details

# 4. Start a search against the Preprod Gateway
curl -s -X POST https://mobility.taqneeki.in/ondc/api/search \
  -H 'Content-Type: application/json' \
  -d '{"from":{"gps":"19.0760,72.8777","name":"CST"},"to":{"gps":"19.1136,72.8683","name":"Andheri"}}'
# Returns {"txnId":"..."}  then watch SSE stream for on_search callback
```
