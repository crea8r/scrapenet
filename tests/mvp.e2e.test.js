import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { waitPort, startNodeScript } from './helpers/servers.js';

const ROOT = new URL('..', import.meta.url).pathname;

describe('ScrapeNet MVP e2e', () => {
  const procs = [];

  beforeAll(async () => {
    // coordinator
    procs.push(
      startNodeScript({
        cwd: `${ROOT}/apps/coordinator`,
        script: 'src/index.js',
        env: { PORT: '8787' }
      })
    );
    await waitPort(8787);

    // poster
    procs.push(
      startNodeScript({
        cwd: `${ROOT}/apps/poster-demo`,
        script: 'src/index.js',
        env: { PORT: '8790', RECEIPT_SECRET: 'test-secret' }
      })
    );
    await waitPort(8790);

    // escrow
    procs.push(
      startNodeScript({
        cwd: `${ROOT}/apps/escrow`,
        script: 'src/index.js',
        env: { PORT: '8791', RECEIPT_SECRET: 'test-secret' }
      })
    );
    await waitPort(8791);
  });

  afterAll(async () => {
    for (const p of procs.reverse()) {
      await p.stop();
    }
  });

  it('can create job, deposit, and push at least one receipt by running two nodes', async () => {
    // create job
    const jobRes = await fetch('http://127.0.0.1:8787/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'testJob',
        name: 'quotes-demo',
        shard: { kind: 'pageRange', start: 1, end: 2 },
        rowLimit: 10,
        posterEndpoint: 'http://127.0.0.1:8790',
        escrowEndpoint: 'http://127.0.0.1:8791',
        pricePerRowMicros: 1,
        depositMicros: 1000
      })
    }).then((r) => r.json());

    expect(jobRes.ok).toBe(true);
    expect(jobRes.job.jobId).toBe('testJob');

    // deposit
    const depRes = await fetch('http://127.0.0.1:8791/jobs/testJob/deposit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ depositMicros: 1000, pricePerRowMicros: 1 })
    }).then((r) => r.json());
    expect(depRes.ok).toBe(true);

    const node1 = startNodeScript({
      cwd: `${ROOT}/apps/node`,
      script: 'src/index.js',
      env: {
        NODE_ID: 'node_test_1',
        COORDINATOR_WS: 'ws://127.0.0.1:8787/ws',
        COORDINATOR_HTTP: 'http://127.0.0.1:8787',
        DATA_DIR: `${ROOT}/.tmp/node1`
      }
    });
    const node2 = startNodeScript({
      cwd: `${ROOT}/apps/node`,
      script: 'src/index.js',
      env: {
        NODE_ID: 'node_test_2',
        COORDINATOR_WS: 'ws://127.0.0.1:8787/ws',
        COORDINATOR_HTTP: 'http://127.0.0.1:8787',
        DATA_DIR: `${ROOT}/.tmp/node2`
      }
    });

    try {
      // wait for some receipts to appear
      const start = Date.now();
      let receipts = [];
      while (Date.now() - start < 40_000) {
        const r = await fetch('http://127.0.0.1:8790/receipts').then((x) => x.json());
        receipts = r.receipts || [];
        if (receipts.find((x) => x.jobId === 'testJob' && x.acceptedRowCount > 0)) break;
        await new Promise((r2) => setTimeout(r2, 500));
      }

      const okReceipt = receipts.find((x) => x.jobId === 'testJob' && x.acceptedRowCount > 0);
      if (!okReceipt) {
        throw new Error(
          `no accepted receipt found. receipts=${JSON.stringify(receipts)}\n` +
            `node1_logs=\n${node1.getOutput()}\nnode2_logs=\n${node2.getOutput()}\n`
        );
      }

      // escrow should have credited at least one of the nodes (leader at time of push)
      const b1 = await fetch('http://127.0.0.1:8791/balance/node_test_1').then((x) => x.json());
      const b2 = await fetch('http://127.0.0.1:8791/balance/node_test_2').then((x) => x.json());
      expect((b1.balanceMicros || 0) + (b2.balanceMicros || 0)).toBeGreaterThan(0);
    } finally {
      await node1.stop();
      await node2.stop();
    }
  });
});
