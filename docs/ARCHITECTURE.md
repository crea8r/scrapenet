# Architecture (draft)

## MVP design choices

### 1) Central coordinator first
- fastest to ship
- easiest job discovery
- later swap to libp2p/DHT

### 2) Poster-signed receipts as the source of truth
- poster already receives/validates data
- receipts become the payout primitive

### 3) Sandboxed script execution
- workerScript and leaderScript run in a restricted runtime
- restrict filesystem/network by policy
- hard timeouts + memory caps

## Responsibilities

### Coordinator
- job registry (create/list/get)
- membership registry (node heartbeats)
- leader election/rotation support (optional)

### Node
- join network
- accept assignments
- execute workerScript
- report rows + metrics

### Leader
- shard assignment
- batching
- push batches to poster endpoint
- collect receipts

### Poster server
- validate rows
- store data
- issue receipts

### Solana program
- escrow USDC
- accept settlement root + poster signature
- allow claims

## Open questions

- attribution: how do we prove which worker produced which rows?
- privacy: do workers ever see the full dataset?
- anti-abuse: rate limiting and legal compliance for scraping targets
- leader selection: randomized VRF vs coordinator-assigned vs stake-weighted

