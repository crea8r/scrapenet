# ScrapeNet (USDC on Solana)

A distributed network of computers that run data-scraping jobs for job posters.

- **Scrapers** (workers) run a client that subscribes to the network and executes tasks.
- **Leaders** orchestrate a job round, aggregate/validate results, and push partial batches to the job-poster’s server.
- **Payments** are incentivized in **USDC on Solana** with on-chain deposits and off-chain settlement proofs.

> Status: scaffold / concept repo. Not production-ready.

## Core idea

1. Anyone can run software to join the network.
2. A job poster creates a job with:
   - (A) **leader script**: orchestration + batching rules (e.g., push to poster server every 1000 rows), plus leader rotation rules
   - (B) **scraper script**: the scraping logic executed by workers
   - (C) **incentive**: e.g., 0.0001 USDC per row ("0.01 cent"), with optional bonuses/penalties
   - (D) **deposit**: USDC locked/escrowed on Solana
3. Nodes automatically pick up jobs; balances increase as batches are accepted and leadership rotates.
4. Scrapers can **claim** payout to their Solana wallet.

## High-level architecture

### Components

- **Coordinator / DHT (optional)**: job discovery + membership. (Start simple: a coordinator HTTP/WebSocket service; later: libp2p.)
- **Node client**:
  - fetches jobs
  - elects/rotates leader
  - runs scraper script in a sandbox
  - streams results to leader
- **Leader runtime**:
  - assigns shards
  - aggregates rows
  - enforces batch size / dedupe
  - pushes batches to poster server
  - emits settlement records
- **Poster server** (provided by job poster):
  - receives batches
  - validates schema + limits
  - signs acceptance receipts
- **Solana program** (escrow):
  - holds USDC deposit
  - allows claims based on accepted receipts / proofs

### Trust model (MVP)

- Poster server is source of truth for “accepted rows”.
- Leader collects poster-signed receipts and submits/attests them for payout.
- Workers claim using receipts (or merkle root of receipts) once posted.

## Repository layout (planned)

- `apps/`
  - `coordinator/` – job registry + websocket channels
  - `node/` – worker + leader runtime
  - `poster-demo/` – reference job-poster server
- `packages/`
  - `protocol/` – message types, receipts, hashing
  - `sandbox/` – script runner (Playwright/Puppeteer/HTTP) + resource limits
  - `solana/` – program + client SDK
- `docs/` – specs and threat model

## Roadmap

### Phase 0 — Local demo
- Coordinator service
- Single job poster + a few nodes
- Fake USDC accounting (off-chain) to validate workflow

### Phase 1 — Settlement + receipts
- Poster-signed receipts
- Merkle batching of receipts
- Claims with on-chain verification (or a minimal optimistic scheme)

### Phase 2 — Hardening
- Script sandboxing, rate limits, allow/deny lists
- Reputation + slashing
- Leader misbehavior handling

## Non-goals (for now)
- Perfect Sybil resistance
- Fully trustless scraping verification

## License

TBD. (Default suggestion: Apache-2.0 for code, MIT for SDKs.)
