import express from 'express';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

const PORT = Number(process.env.PORT || 8787);
const POSTER_API_KEY = process.env.POSTER_API_KEY || ''; // if set, protects job creation

const app = express();
app.use(express.json({ limit: '5mb' }));

/** In-memory state (MVP)
 * nodes: nodeId -> { nodeId, ws, connectedAt, lastSeenAt, meta }
 * jobs: jobId -> job
 */
const state = {
  nodes: new Map(),
  jobs: new Map(),
  leaderByJob: new Map(), // jobId -> nodeId
  pending: new Map() // reqId -> { fromNodeId, type }
};

function now() {
  return Date.now();
}

function listNodes() {
  return [...state.nodes.values()].map((n) => ({
    nodeId: n.nodeId,
    connectedAt: n.connectedAt,
    lastSeenAt: n.lastSeenAt,
    meta: n.meta
  }));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const n of state.nodes.values()) {
    try {
      n.ws.send(data);
    } catch {
      // ignore
    }
  }
}

function sendTo(nodeId, msg) {
  const n = state.nodes.get(nodeId);
  if (!n) return false;
  try {
    n.ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function pickRandomNode(excludeNodeId) {
  const candidates = [...state.nodes.keys()].filter((id) => id !== excludeNodeId);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** REST: create a job (MVP)
 * If POSTER_API_KEY is set, requires header: X-Poster-Key
 */
app.post('/jobs', (req, res) => {
  if (POSTER_API_KEY) {
    const k = req.header('x-poster-key') || '';
    if (k !== POSTER_API_KEY) return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const job = req.body || {};
  const jobId = job.jobId || nanoid();

  const normalized = {
    jobId,
    name: job.name || 'unnamed-job',
    kind: job.kind || 'quotes-to-scrape',

    // Two shard types supported:
    // - pageRange: {start,end}
    // - list: {items:[...]} (e.g., URLs)
    shard: job.shard || { kind: 'pageRange', start: 1, end: 10 },

    // For price monitoring template
    template: job.template || null,
    targets: Array.isArray(job.targets) ? job.targets : null,

    rowLimit: Number(job.rowLimit || 1000),
    posterEndpoint: job.posterEndpoint || 'http://localhost:8790',
    escrowEndpoint: job.escrowEndpoint || 'http://localhost:8791',
    pricePerRowMicros: Number(job.pricePerRowMicros || 100),
    depositMicros: Number(job.depositMicros || 1000000),
    createdAt: now()
  };

  state.jobs.set(jobId, normalized);

  // assign initial leader if we have nodes
  if (!state.leaderByJob.get(jobId)) {
    const first = [...state.nodes.keys()][0];
    if (first) {
      state.leaderByJob.set(jobId, first);
      sendTo(first, { type: 'role', jobId, role: 'leader', job: normalized });
      broadcast({ type: 'leaderChanged', jobId, leaderNodeId: first });
    }
  }

  res.json({ ok: true, job: normalized, leaderNodeId: state.leaderByJob.get(jobId) || null });
});

app.get('/jobs', (_req, res) => {
  const jobs = [...state.jobs.values()].map((j) => ({
    ...j,
    leaderNodeId: state.leaderByJob.get(j.jobId) || null
  }));
  res.json({ ok: true, jobs });
});

app.get('/nodes', (_req, res) => {
  res.json({ ok: true, nodes: listNodes() });
});

app.get('/workers', (_req, res) => {
  // MVP: workers == connected nodes
  res.json({ ok: true, workers: listNodes() });
});

/** Rotate leader for a job (triggered by leader after pushing a batch) */
app.post('/jobs/:jobId/rotate-leader', (req, res) => {
  const { jobId } = req.params;
  const current = state.leaderByJob.get(jobId) || null;
  const next = pickRandomNode(current);
  if (!next) {
    return res.status(409).json({ ok: false, error: 'no-other-nodes-connected' });
  }
  state.leaderByJob.set(jobId, next);

  // demote previous leader
  if (current) sendTo(current, { type: 'role', jobId, role: 'worker' });

  const job = state.jobs.get(jobId);
  if (job) sendTo(next, { type: 'role', jobId, role: 'leader', job });

  broadcast({ type: 'leaderChanged', jobId, leaderNodeId: next });
  res.json({ ok: true, jobId, leaderNodeId: next });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let nodeId = null;

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      nodeId = msg.nodeId || nanoid();
      const meta = msg.meta || {};
      state.nodes.set(nodeId, { nodeId, ws, connectedAt: now(), lastSeenAt: now(), meta });

      ws.send(JSON.stringify({ type: 'helloAck', nodeId }));

      // if jobs exist and no leader assigned, set first node as leader for each
      for (const job of state.jobs.values()) {
        if (!state.leaderByJob.get(job.jobId)) {
          state.leaderByJob.set(job.jobId, nodeId);
          sendTo(nodeId, { type: 'role', jobId: job.jobId, role: 'leader', job });
          broadcast({ type: 'leaderChanged', jobId: job.jobId, leaderNodeId: nodeId });
        } else {
          // ensure new node starts as worker
          sendTo(nodeId, { type: 'role', jobId: job.jobId, role: 'worker' });
        }
      }

      return;
    }

    if (!nodeId) return;

    const rec = state.nodes.get(nodeId);
    if (rec) rec.lastSeenAt = now();

    // allow nodes to request jobs list
    if (msg.type === 'listJobs') {
      const jobs = [...state.jobs.values()].map((j) => ({
        ...j,
        leaderNodeId: state.leaderByJob.get(j.jobId) || null
      }));
      ws.send(JSON.stringify({ type: 'jobs', jobs }));
      return;
    }

    // worker -> coordinator -> leader: request a shard
    if (msg.type === 'needShard') {
      const { reqId, jobId } = msg;
      const leaderId = state.leaderByJob.get(jobId);
      if (!reqId || !jobId || !leaderId) {
        ws.send(JSON.stringify({ type: 'shardAssignment', reqId, ok: false, error: 'no-leader-or-bad-request' }));
        return;
      }
      state.pending.set(reqId, { fromNodeId: nodeId, type: 'needShard' });
      sendTo(leaderId, { type: 'needShard', reqId, jobId, workerNodeId: nodeId });
      return;
    }

    // leader -> coordinator -> worker: reply with assignment
    if (msg.type === 'shardAssignment') {
      const { reqId } = msg;
      const pend = state.pending.get(reqId);
      if (!pend) return;
      state.pending.delete(reqId);
      sendTo(pend.fromNodeId, msg);
      return;
    }

    // worker -> coordinator -> leader: submit result
    if (msg.type === 'submitResult') {
      const { reqId, jobId } = msg;
      const leaderId = state.leaderByJob.get(jobId);
      if (!reqId || !jobId || !leaderId) {
        ws.send(JSON.stringify({ type: 'resultAck', reqId, ok: false, error: 'no-leader-or-bad-request' }));
        return;
      }
      state.pending.set(reqId, { fromNodeId: nodeId, type: 'submitResult' });
      sendTo(leaderId, { ...msg, workerNodeId: nodeId });
      return;
    }

    // leader -> coordinator -> worker: ack result
    if (msg.type === 'resultAck') {
      const { reqId } = msg;
      const pend = state.pending.get(reqId);
      if (!pend) return;
      state.pending.delete(reqId);
      sendTo(pend.fromNodeId, msg);
      return;
    }
  });

  ws.on('close', () => {
    if (!nodeId) return;
    state.nodes.delete(nodeId);

    // if node was leader for any job, rotate
    for (const [jobId, leaderId] of state.leaderByJob.entries()) {
      if (leaderId === nodeId) {
        const next = pickRandomNode(nodeId);
        if (next) {
          state.leaderByJob.set(jobId, next);
          const job = state.jobs.get(jobId);
          if (job) sendTo(next, { type: 'role', jobId, role: 'leader', job });
          broadcast({ type: 'leaderChanged', jobId, leaderNodeId: next });
        } else {
          state.leaderByJob.delete(jobId);
          broadcast({ type: 'leaderChanged', jobId, leaderNodeId: null });
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[coordinator] listening on http://localhost:${PORT}`);
  console.log(`[coordinator] ws on ws://localhost:${PORT}/ws`);
});
