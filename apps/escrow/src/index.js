import express from 'express';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8791);
const RECEIPT_SECRET = process.env.RECEIPT_SECRET || 'dev-secret-change-me';

const app = express();
app.use(express.json({ limit: '5mb' }));

/**
 * This is a centralized “USDC escrow” simulation:
 * - balances are tracked in micros (1e-6)
 * - poster receipts authorize settlement
 * - workers can claim to a "wallet" string
 */
const state = {
  jobs: new Map(), // jobId -> { depositMicros, spentMicros, pricePerRowMicros }
  balances: new Map() // workerId -> micros
};

function verifySignature(body, signature) {
  const payload = JSON.stringify(body);
  const expected = crypto.createHmac('sha256', RECEIPT_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

app.post('/jobs/:jobId/deposit', (req, res) => {
  const { jobId } = req.params;
  const { depositMicros, pricePerRowMicros } = req.body || {};
  if (!depositMicros || !pricePerRowMicros) {
    return res.status(400).json({ ok: false, error: 'missing depositMicros/pricePerRowMicros' });
  }
  state.jobs.set(jobId, {
    depositMicros: Number(depositMicros),
    spentMicros: 0,
    pricePerRowMicros: Number(pricePerRowMicros)
  });
  res.json({ ok: true, jobId });
});

/**
 * Settle accepted rows to a worker balance.
 * MVP: leader calls this with the poster receipt + worker attribution.
 */
app.post('/settle', (req, res) => {
  const { receipt, workerId } = req.body || {};
  if (!receipt?.jobId || !receipt?.batchId || typeof receipt?.acceptedRowCount !== 'number' || !receipt?.signature) {
    return res.status(400).json({ ok: false, error: 'bad-receipt' });
  }
  if (!workerId) return res.status(400).json({ ok: false, error: 'missing workerId' });

  const { signature, ...body } = receipt;
  if (!verifySignature(body, signature)) {
    return res.status(401).json({ ok: false, error: 'invalid-signature' });
  }

  const job = state.jobs.get(receipt.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'unknown-job' });

  const payout = Number(receipt.acceptedRowCount) * Number(job.pricePerRowMicros);
  if (job.spentMicros + payout > job.depositMicros) {
    return res.status(409).json({ ok: false, error: 'insufficient-deposit' });
  }

  job.spentMicros += payout;
  state.jobs.set(receipt.jobId, job);

  state.balances.set(workerId, (state.balances.get(workerId) || 0) + payout);

  res.json({ ok: true, creditedMicros: payout, workerBalanceMicros: state.balances.get(workerId) });
});

app.get('/balance/:workerId', (req, res) => {
  res.json({ ok: true, workerId: req.params.workerId, balanceMicros: state.balances.get(req.params.workerId) || 0 });
});

app.post('/claim', (req, res) => {
  const { workerId, wallet } = req.body || {};
  if (!workerId || !wallet) return res.status(400).json({ ok: false, error: 'missing workerId/wallet' });

  const bal = state.balances.get(workerId) || 0;
  if (bal <= 0) return res.status(409).json({ ok: false, error: 'nothing-to-claim' });

  // simulate transfer
  state.balances.set(workerId, 0);
  res.json({ ok: true, workerId, wallet, transferredMicros: bal });
});

app.listen(PORT, () => {
  console.log(`[escrow] listening on http://localhost:${PORT}`);
});
