import { WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const COORDINATOR_WS = process.env.COORDINATOR_WS || 'ws://localhost:8787/ws';
const NODE_ID = process.env.NODE_ID || `node_${nanoid(6)}`;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data', NODE_ID);

fs.mkdirSync(DATA_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function canonicalRow(row) {
  return JSON.stringify(row, Object.keys(row).sort());
}

async function httpJson(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

/**
 * Built-in demo scraping: quotes.toscrape.com/page/{n}
 */
async function scrapeQuotesPage(pageNumber) {
  const url = `https://quotes.toscrape.com/page/${pageNumber}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const rows = [];

  for (const el of $('.quote').toArray()) {
    const text = $(el).find('.text').text();
    const author = $(el).find('.author').text();
    const tags = $(el)
      .find('.tags a.tag')
      .toArray()
      .map((t) => $(t).text());

    rows.push({ text, author, tags, sourceUrl: url });
  }

  return rows;
}

class LeaderRuntime {
  constructor({ nodeId, job }) {
    this.nodeId = nodeId;
    this.job = job;

    this.jobDir = path.join(DATA_DIR, 'leader', job.jobId);
    fs.mkdirSync(this.jobDir, { recursive: true });

    this.statePath = path.join(this.jobDir, 'state.json');
    this.rowsPath = path.join(this.jobDir, 'rows.jsonl');

    this.state = this._loadState();

    // shard queue: page numbers
    const shard = job.shard || { kind: 'pageRange', start: 1, end: 10 };
    const start = shard.start || 1;
    const end = shard.end || 10;
    this.pages = [];
    for (let p = start; p <= end; p++) this.pages.push(p);

    // track outstanding assignments
    this.inflight = new Map(); // workerId -> pageNumber

    this.batch = [];
    this.batchRowLimit = Number(job.rowLimit || 1000);
  }

  _loadState() {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {
        jobId: this.job.jobId,
        leaderNodeId: this.nodeId,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        nextShardIndex: 0,
        assigned: 0,
        completedShards: 0,
        producedRows: 0,
        acceptedRows: 0,
        batchesPushed: 0
      };
    }
  }

  _saveState() {
    this.state.lastUpdatedAt = Date.now();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * (1) current where are we in the work
   * (2) how much work left
   */
  progress() {
    const total = this.pages.length;
    const done = this.state.completedShards;
    const remaining = Math.max(0, total - done);
    return {
      jobId: this.job.jobId,
      leaderNodeId: this.nodeId,
      shardKind: 'pageRange',
      totalShards: total,
      completedShards: done,
      remainingShards: remaining,
      producedRows: this.state.producedRows,
      acceptedRows: this.state.acceptedRows,
      batchesPushed: this.state.batchesPushed,
      inflight: [...this.inflight.entries()].map(([workerId, page]) => ({ workerId, page }))
    };
  }

  /**
   * (3) distribute tasks so work can run in parallel
   */
  assignShard(workerId) {
    if (this.inflight.has(workerId)) {
      return { ok: true, assignment: { pageNumber: this.inflight.get(workerId) } };
    }

    const idx = this.state.nextShardIndex;
    if (idx >= this.pages.length) {
      return { ok: false, done: true };
    }

    const pageNumber = this.pages[idx];
    this.state.nextShardIndex += 1;
    this.state.assigned += 1;
    this.inflight.set(workerId, pageNumber);
    this._saveState();

    return { ok: true, assignment: { pageNumber } };
  }

  handleNeedShard({ reqId, workerNodeId }) {
    const res = this.assignShard(workerNodeId);
    return {
      type: 'shardAssignment',
      reqId,
      jobId: this.job.jobId,
      ...res
    };
  }

  async handleSubmitResult({ reqId, workerNodeId, pageNumber, rows }) {
    const result = await this.ingestResult({ workerId: workerNodeId, pageNumber, rows });
    return { type: 'resultAck', reqId, jobId: this.job.jobId, ok: result.ok, result };
  }

  /**
   * Handle a worker result. Persist rows locally (leader) and push when rowLimit hit.
   */
  async ingestResult({ workerId, pageNumber, rows }) {
    const inflightPage = this.inflight.get(workerId);
    if (inflightPage !== pageNumber) {
      return { ok: false, error: 'unexpected-assignment' };
    }

    this.inflight.delete(workerId);
    this.state.completedShards += 1;

    let appended = 0;
    for (const row of rows) {
      const rowHash = sha256(canonicalRow(row));
      const rec = {
        jobId: this.job.jobId,
        row,
        rowHash,
        workerId,
        pageNumber,
        ts: Date.now()
      };
      fs.appendFileSync(this.rowsPath, JSON.stringify(rec) + '\n');
      this.batch.push(rec);
      appended += 1;
    }

    this.state.producedRows += appended;
    this._saveState();

    if (this.batch.length >= this.batchRowLimit) {
      await this.pushBatch();
      return { ok: true, pushed: true, progress: this.progress() };
    }

    return { ok: true, pushed: false, progress: this.progress() };
  }

  /**
   * (4) save the work on leader computer and push when hit row limit
   */
  async pushBatch() {
    const batchId = `batch_${nanoid(8)}`;
    const toSend = this.batch.splice(0, this.batchRowLimit);
    const rows = toSend.map((r) => r.row);

    // push to poster
    const ingest = await httpJson(`${this.job.posterEndpoint}/ingest`, {
      method: 'POST',
      body: { jobId: this.job.jobId, batchId, rows }
    });

    const receipt = ingest.receipt;
    this.state.acceptedRows += receipt.acceptedRowCount;
    this.state.batchesPushed += 1;
    this._saveState();

    // settle: attribute to workers proportionally (MVP: credit all to leader; keep it simple)
    await httpJson(`${this.job.escrowEndpoint}/settle`, {
      method: 'POST',
      body: { receipt, workerId: this.nodeId }
    });

    // ask coordinator to rotate leader (best-effort)
    try {
      await httpJson(`${(this.job.coordinatorHttp || 'http://localhost:8787')}/jobs/${this.job.jobId}/rotate-leader`, {
        method: 'POST',
        body: { reason: 'batchPushed', batchId }
      });
    } catch {
      // ignore
    }

    return { ok: true, batchId, acceptedRowCount: receipt.acceptedRowCount };
  }
}

class NodeApp {
  constructor() {
    this.ws = null;
    this.jobs = [];
    this.currentLeader = new Map();
    this.leaderRuntimes = new Map(); // jobId -> LeaderRuntime
    this.pending = new Map(); // reqId -> { resolve, reject, timeout }

    // If coordinator host differs from ws url, allow setting HTTP base
    this.coordinatorHttp = process.env.COORDINATOR_HTTP || 'http://localhost:8787';
  }

  connect() {
    this.ws = new WebSocket(COORDINATOR_WS);

    this.ws.on('open', () => {
      this.ws.send(
        JSON.stringify({
          type: 'hello',
          nodeId: NODE_ID,
          meta: { version: '0.1.0', dataDir: DATA_DIR }
        })
      );

      // periodically refresh jobs
      setInterval(() => {
        try {
          this.ws.send(JSON.stringify({ type: 'listJobs' }));
        } catch {
          // ignore
        }
      }, 2500);
    });

    this.ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      this.onMessage(msg).catch((e) => console.error('[node] msg handler error', e));
    });

    this.ws.on('close', () => {
      console.log('[node] disconnected; reconnecting soon');
      setTimeout(() => this.connect(), 1000);
    });
  }

  async onMessage(msg) {
    if (msg.type === 'helloAck') {
      console.log(`[node] connected as ${msg.nodeId}`);
      return;
    }

    if (msg.type === 'jobs') {
      this.jobs = msg.jobs || [];
      return;
    }

    if (msg.type === 'leaderChanged') {
      this.currentLeader.set(msg.jobId, msg.leaderNodeId);
      return;
    }

    if (msg.type === 'role' && msg.role === 'leader') {
      const job = { ...msg.job, coordinatorHttp: this.coordinatorHttp };
      console.log(`[node] became LEADER for job ${job.jobId}`);
      this.leaderRuntimes.set(job.jobId, new LeaderRuntime({ nodeId: NODE_ID, job }));
      return;
    }

    if (msg.type === 'role' && msg.role === 'worker') {
      // demotion
      if (this.leaderRuntimes.has(msg.jobId)) {
        console.log(`[node] became WORKER for job ${msg.jobId}`);
        this.leaderRuntimes.delete(msg.jobId);
      }
      return;
    }

    // --- Worker RPC replies
    if (msg.type === 'shardAssignment' || msg.type === 'resultAck') {
      const reqId = msg.reqId;
      const p = this.pending.get(reqId);
      if (!p) return;
      clearTimeout(p.timeout);
      this.pending.delete(reqId);
      p.resolve(msg);
      return;
    }

    // --- Leader RPC requests (from coordinator)
    if (msg.type === 'needShard') {
      const leader = this.leaderRuntimes.get(msg.jobId);
      if (!leader) return;
      const reply = leader.handleNeedShard({ reqId: msg.reqId, workerNodeId: msg.workerNodeId });
      this.ws.send(JSON.stringify(reply));
      return;
    }

    if (msg.type === 'submitResult') {
      const leader = this.leaderRuntimes.get(msg.jobId);
      if (!leader) return;
      const reply = await leader.handleSubmitResult({
        reqId: msg.reqId,
        workerNodeId: msg.workerNodeId,
        pageNumber: msg.pageNumber,
        rows: msg.rows
      });
      this.ws.send(JSON.stringify(reply));
      return;
    }
  }

  sendRequest(msg, timeoutMs = 30_000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ws-not-connected');
    }
    const reqId = msg.reqId || `req_${nanoid(8)}`;
    const payload = { ...msg, reqId };

    const p = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('request-timeout'));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timeout });
    });

    this.ws.send(JSON.stringify(payload));
    return p;
  }

  /** Worker loop: find a job, ask the leader for a shard, execute, return rows. */
  async runWorkerLoop() {
    while (true) {
      await sleep(400);
      const job = this.jobs[0];
      if (!job) continue;

      const leaderNodeId = job.leaderNodeId || this.currentLeader.get(job.jobId);
      if (!leaderNodeId) continue;

      // if I'm the leader, skip worker actions for this job
      if (leaderNodeId === NODE_ID) continue;

      try {
        const assigned = await this.sendRequest({ type: 'needShard', jobId: job.jobId }, 10_000);
        if (!assigned.ok) {
          if (assigned.done) {
            await sleep(1500);
            continue;
          }
          await sleep(800);
          continue;
        }

        const pageNumber = assigned.assignment.pageNumber;
        const rows = await scrapeQuotesPage(pageNumber);

        const ack = await this.sendRequest({ type: 'submitResult', jobId: job.jobId, pageNumber, rows }, 30_000);
        if (!ack.ok) {
          console.error('[worker] submit failed', ack.error);
        }
      } catch (e) {
        // coordinator/leader might be rotating; just retry
        await sleep(800);
      }
    }
  }

  /**
   * Leader loop: allow local pseudo-workers inside same process to demonstrate parallelism.
   * You can run multiple node processes to get true parallelism.
   */
  async runLeaderLoop() {
    const simWorkers = Number(process.env.SIM_WORKERS || 0);

    while (true) {
      await sleep(500);
      for (const [jobId, leader] of this.leaderRuntimes.entries()) {
        if (simWorkers <= 0) continue;

        // optional simulation workers on the leader machine
        const workerIds = Array.from({ length: simWorkers }).map((_, i) => `${NODE_ID}:sim${i + 1}`);
        const assignments = workerIds
          .map((wid) => ({ wid, res: leader.assignShard(wid) }))
          .filter((x) => x.res.ok && x.res.assignment);

        await Promise.all(
          assignments.map(async ({ wid, res }) => {
            const pageNumber = res.assignment.pageNumber;
            try {
              const rows = await scrapeQuotesPage(pageNumber);
              await leader.ingestResult({ workerId: wid, pageNumber, rows });
              console.log('[leader]', leader.progress());
            } catch (e) {
              console.error(`[leader] scrape failed page=${pageNumber}`, e.message);
              // release inflight so it can be retried later (simple)
              leader.inflight.delete(wid);
            }
          })
        );
      }
    }
  }
}

const app = new NodeApp();
app.connect();

// Run both loops: each node can be a worker; leaders also coordinate and push batches.
app.runWorkerLoop().catch((e) => {
  console.error(e);
  process.exit(1);
});

app.runLeaderLoop().catch((e) => {
  console.error(e);
  process.exit(1);
});
