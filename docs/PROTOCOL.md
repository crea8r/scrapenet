# Protocol (draft)

This is a **draft** protocol spec for ScrapeNet.

## Actors

- **Poster**: job creator + owner of the destination server.
- **Coordinator**: job discovery + membership (MVP: centralized).
- **Leader**: elected node for a job round; assigns work shards; batches results; talks to poster server.
- **Worker**: runs scraper tasks; streams results to leader.

## Job definition

A job is described by:

- `jobId`: unique identifier
- `leaderScript`: orchestration script and batching rules
- `workerScript`: scraping script (executed on workers)
- `pricePerRow`: denominated in USDC (6 decimals)
- `depositMint`: USDC mint address (Solana)
- `depositAmount`: total budget
- `posterEndpoint`: where leader pushes batches
- `posterPubkey`: used to verify receipts
- `constraints`: rate limits, max rows, timeouts, schemas

## Data model

### Row

A “row” is an application-defined JSON object that passes schema validation.

- A row MUST have a deterministic canonical encoding for hashing.
- Dedupe key is `rowHash = sha256(canonical(row))`.

### Batch

Leader groups accepted rows into batches.

- `batchId`
- `jobId`
- `leaderId`
- `rows[]`
- `rowHashes[]`
- `count`
- `merkleRoot` (optional)

## Receipts

Poster returns a signed receipt for each accepted batch (or for a merkle root of many batches).

Receipt fields (suggested):

- `jobId`
- `batchId`
- `acceptedRowCount`
- `acceptedRowHashesRoot` (optional)
- `totalPayout = acceptedRowCount * pricePerRow`
- `issuedAt`
- `expiresAt`
- `posterSignature`

## Settlement

MVP: off-chain settlement record that can later be posted on-chain.

- Worker balance increments are derived from:
  - accepted rows attributed to that worker (if attribution exists)
  - plus leader rotation rewards (if any)

## Leader rotation

Rotation policy examples:

- rotate every N accepted rows (e.g., 1000)
- rotate every T minutes
- rotate when leader fails health checks

## Threat model (partial)

- Worker submits bogus rows → mitigated by poster validation + schema + dedupe.
- Leader withholds receipts → mitigated by workers being able to request receipts; coordinator can blacklist.
- Sybil attacks → mitigated later via stake/reputation.

