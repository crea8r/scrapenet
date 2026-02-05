# Demo (working MVP)

This MVP runs:

- coordinator (job registry + websocket relay)
- poster-demo (accepts batches + returns signed receipts)
- escrow (centralized ledger that holds deposit + releases on claim)
- multiple nodes (workers/leaders)

## 0) Install

From repo root:

```bash
corepack enable
pnpm install
```

## 1) Start services (3 terminals)

### Terminal A — coordinator

```bash
pnpm --filter @scrapenet/coordinator dev
```

### Terminal B — poster-demo

```bash
export RECEIPT_SECRET=dev-secret-change-me
pnpm --filter @scrapenet/poster-demo dev
```

### Terminal C — escrow

```bash
export RECEIPT_SECRET=dev-secret-change-me
pnpm --filter @scrapenet/escrow dev
```

## 2) Create a job + deposit

Create job (example: scrape quotes pages 1..25; push every 50 rows):

```bash
curl -s http://localhost:8787/jobs \
  -H 'content-type: application/json' \
  -d '{
    "name": "quotes-demo",
    "kind": "quotes-to-scrape",
    "shard": {"kind":"pageRange","start":1,"end":25},
    "rowLimit": 50,
    "posterEndpoint": "http://localhost:8790",
    "escrowEndpoint": "http://localhost:8791",
    "pricePerRowMicros": 100,
    "depositMicros": 200000
  }' | jq
```

Deposit to escrow (replace JOB_ID):

```bash
curl -s http://localhost:8791/jobs/JOB_ID/deposit \
  -H 'content-type: application/json' \
  -d '{"depositMicros":200000,"pricePerRowMicros":100}' | jq
```

## 3) Start nodes (at least 2)

### Node 1

```bash
export NODE_ID=node1
pnpm --filter @scrapenet/node dev
```

### Node 2

```bash
export NODE_ID=node2
pnpm --filter @scrapenet/node dev
```

Coordinator will assign a leader; workers request shards via coordinator and submit results. After each batch push, coordinator rotates leader.

## 4) Observe progress

- Jobs + current leader:

```bash
curl -s http://localhost:8787/jobs | jq
```

- Poster receipts:

```bash
curl -s http://localhost:8790/receipts | jq
```

- Worker balances (MVP credits leader nodeId; we can improve attribution next):

```bash
curl -s http://localhost:8791/balance/node1 | jq
curl -s http://localhost:8791/balance/node2 | jq
```

## 5) Claim

```bash
curl -s http://localhost:8791/claim \
  -H 'content-type: application/json' \
  -d '{"workerId":"node1","wallet":"So11111111111111111111111111111111111111112"}' | jq
```

## Leader persistence

Leader stores its state and all produced rows at:

- `apps/node/data/<NODE_ID>/leader/<JOB_ID>/state.json`
- `apps/node/data/<NODE_ID>/leader/<JOB_ID>/rows.jsonl`

The leader pushes to the poster endpoint when `rowLimit` is hit.
