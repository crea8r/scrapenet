import { spawn } from 'node:child_process';
import net from 'node:net';

export async function waitPort(port, host = '127.0.0.1', timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const s = net.createConnection({ port, host });
      s.on('connect', () => {
        s.end();
        resolve(true);
      });
      s.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`port ${host}:${port} did not open in time`);
}

export function startNodeScript({ cwd, script, env = {} }) {
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));

  return {
    child,
    getOutput: () => out,
    stop: async () => {
      if (child.killed) return;
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!child.killed) child.kill('SIGKILL');
    }
  };
}
