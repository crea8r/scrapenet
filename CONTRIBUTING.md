# Contributing to ScrapeNet

ScrapeNet is early-stage. The fastest way to help is to run the demo, then pick a focused improvement.

## Dev setup

```bash
corepack enable
pnpm install
```

## Run the demo

See [`docs/DEMO.md`](docs/DEMO.md).

## Where to contribute (high-impact)

### 1) Per-worker attribution + settlement
Right now escrow credits the leader by default. We need to attribute accepted rows to workers.

Suggested approach:
- Leader already persists `rows.jsonl` with `workerId` per row.
- Poster receipt should include accepted row hashes (or a Merkle root + proofs).
- Leader (or workers) can then settle balances per worker.

### 2) Sandbox + scriptable jobs
Define a safe JS job interface:
- `workerScript.js`: takes an assignment, returns rows
- `leaderScript.js`: defines shard space, batching rules, rotation

Add sandboxing:
- timeout
- memory cap
- network allowlist

### 3) Reliability
- shard leasing (so work gets re-assigned if worker dies)
- leader crash recovery (resume from `state.json`)
- backpressure + rate limiting

### 4) Basic dashboard
A minimal web UI showing:
- job progress
- current leader
- receipts / balances

## Code style
- Keep it simple, readable, boring.
- Prefer explicit JSON payloads over clever abstractions.

## Security / ethics
This is a scraping network; contributors should consider legal + ethical constraints.
Do not ship “default jobs” that clearly violate ToS or laws.
