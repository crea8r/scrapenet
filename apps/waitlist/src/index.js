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

// Public endpoint: last N signups (redacted)
app.get('/api/signups', (req, res) => {
  const limit = Math.max(0, Math.min(Number(req.query.limit || 50), 500));
  let rows = [];

  try {
    const raw = fs.readFileSync(SIGNUPS_PATH, 'utf8');
    const lines = raw.trim().length ? raw.trim().split('\n') : [];
    const tail = lines.slice(-limit);
    rows = tail
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map((s) => ({
        ts: s.ts,
        handle: s.handle,
        platform: s.platform,
        region: s.region,
        canPlaywright: !!s.canPlaywright,
        canHeadful: !!s.canHeadful,
        proxyType: s.proxyType,
        jobTypes: s.jobTypes
      }));
  } catch {
    rows = [];
  }

  res.json({ ok: true, signups: rows });
});

// Public HTML page for humans
app.get('/signups', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'signups.html'));
});

app.listen(PORT, () => {
  console.log(`[waitlist] listening on http://0.0.0.0:${PORT}`);
  console.log(`[waitlist] writing signups to ${SIGNUPS_PATH}`);
});
