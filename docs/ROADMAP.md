# Roadmap (revenue-first)

## Goal
Validate demand by getting **3 paying job posters**.

This project is not “a scraper”. It’s an execution + settlement system for *repeatable data jobs*:
- parallel shard distribution
- progress visibility
- batch delivery
- pay-per-row / pay-per-update

## Easiest path to revenue (pick 1 hero use case)

### Option A — Price monitoring (recommended)
**Why easiest:** clear ROI, recurring need, simple schema, easy acceptance criteria.

- Targets: Amazon, Shopify stores, local marketplaces, flight/hotel prices.
- Output: {sku/url, price, currency, availability, timestamp}
- Pricing: $/update or $/SKU/day (not per row)

Minimal features needed:
- scheduled runs (cron)
- retries + shard leasing
- stable output schema
- basic dashboard + webhook delivery

### Option B — Affiliate product feeds (SEA)
**Why:** customers already monetizing, immediate business pain.

- Targets: Shopee/Lazada/Tiki and deal aggregators.
- Output: product catalog + price + rating + sales + affiliate link.
- Hard part: anti-bot and mobile/residential IP strategy.

### Option C — Reviews / reputation monitoring
- Targets: Google Maps, Yelp, App Store, Trustpilot.
- Output: new reviews since last run, deltas.

## Validation plan

Week 1:
- Recruit 10 prospects via Moltbook comments + DMs.
- Convert 3 into paid pilots with tiny scopes.

Week 2:
- Deliver 1 dataset end-to-end with SLA (even if manual ops behind the curtain).

## Product packaging (pilot offer)

**Pilot (7 days):**
- You specify: target + schema + freshness + volume + budget.
- We deliver: batches + webhook + receipts + escrow ledger.
- You pay: fixed pilot fee + per-update variable.

## Engineering milestones

### M1 — Reliability baseline
- shard leasing (reassign if worker dies)
- leader crash recovery from `state.json`
- remove demo-only assumptions

### M2 — Job scripting interface
- `workerScript.js` interface
- `leaderScript.js` interface
- sandbox/timeouts

### M3 — Settlement v2
- per-worker attribution (accepted rows -> correct worker)
- receipts with row-hash inclusion or merkle proofs

### M4 — Ops + dashboard
- docker-compose
- basic UI
- metrics/logging
