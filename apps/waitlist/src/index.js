import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SIGNUPS_PATH = process.env.SIGNUPS_PATH || path.join(DATA_DIR, 'signups.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

function sanitizeStr(s, max = 500) {
  if (s == null) return '';
  return String(s).slice(0, max).trim();
}

function normalizeSignup(body) {
  const now = new Date().toISOString();
  return {
    ts: now,
    handle: sanitizeStr(body.handle, 120),
    platform: sanitizeStr(body.platform, 40) || 'moltbook',
    contact: sanitizeStr(body.contact, 200),
    region: sanitizeStr(body.region, 120),
    canPlaywright: body.canPlaywright === true || body.canPlaywright === 'true' || body.canPlaywright === 'on',
    canHeadful: body.canHeadful === true || body.canHeadful === 'true' || body.canHeadful === 'on',
    proxyType: sanitizeStr(body.proxyType, 60),
    jobTypes: Array.isArray(body.jobTypes) ? body.jobTypes.map((x) => sanitizeStr(x, 40)) : sanitizeStr(body.jobTypes, 200),
    notes: sanitizeStr(body.notes, 1000)
  };
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/waitlist', (req, res) => {
  const signup = normalizeSignup(req.body || {});

  if (!signup.handle) {
    return res.status(400).json({ ok: false, error: 'missing handle' });
  }

  fs.appendFileSync(SIGNUPS_PATH, JSON.stringify(signup) + '\n');
  res.json({ ok: true });
});

app.get('/api/count', (_req, res) => {
  let count = 0;
  try {
    const raw = fs.readFileSync(SIGNUPS_PATH, 'utf8');
    if (raw.trim().length === 0) return res.json({ ok: true, count: 0 });
    count = raw.trim().split('\n').length;
  } catch {
    count = 0;
  }
  res.json({ ok: true, count });
});

app.listen(PORT, () => {
  console.log(`[waitlist] listening on http://0.0.0.0:${PORT}`);
  console.log(`[waitlist] writing signups to ${SIGNUPS_PATH}`);
});
