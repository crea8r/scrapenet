import express from 'express';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8790);
const RECEIPT_SECRET = process.env.RECEIPT_SECRET || 'dev-secret-change-me';

const app = express();
app.use(express.json({ limit: '10mb' }));

// naive in-memory store
const state = {
  jobs: new Map(), // jobId -> { rows: [], count }
  receipts: []
};

function canonicalRow(row) {
  // stable JSON for hashing; good enough for MVP
  return JSON.stringify(row, Object.keys(row).sort());
}

function hashRow(row) {
  return crypto.createHash('sha256').update(canonicalRow(row)).digest('hex');
}

function sign(obj) {
  const payload = JSON.stringify(obj);
  return crypto.createHmac('sha256', RECEIPT_SECRET).update(payload).digest('hex');
}

app.post('/ingest', (req, res) => {
  const { jobId, batchId, rows } = req.body || {};
  if (!jobId || !batchId || !Array.isArray(rows)) {
    return res.status(400).json({ ok: false, error: 'missing jobId/batchId/rows' });
  }

  const jobRec = state.jobs.get(jobId) || { rows: [], count: 0, rowHashes: new Set() };

  let accepted = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const h = hashRow(r);
    if (jobRec.rowHashes.has(h)) continue; // dedupe
    jobRec.rowHashes.add(h);
    jobRec.rows.push(r);
    accepted++;
  }

  jobRec.count += accepted;
  state.jobs.set(jobId, jobRec);

  const receiptBody = {
    jobId,
    batchId,
    acceptedRowCount: accepted,
    issuedAt: Date.now()
  };
  const receipt = {
    ...receiptBody,
    signature: sign(receiptBody)
  };
  state.receipts.push(receipt);

  res.json({ ok: true, receipt, totalAcceptedForJob: jobRec.count });
});

app.get('/jobs/:jobId', (req, res) => {
  const rec = state.jobs.get(req.params.jobId);
  if (!rec) return res.status(404).json({ ok: false, error: 'not-found' });
  res.json({ ok: true, jobId: req.params.jobId, count: rec.count });
});

app.get('/receipts', (_req, res) => {
  res.json({ ok: true, receipts: state.receipts.slice(-200) });
});

app.listen(PORT, () => {
  console.log(`[poster-demo] listening on http://localhost:${PORT}`);
});
