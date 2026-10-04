import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExecutionProfile } from '../portal/scripts/execution-profile.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();
let stopping = false;
let finalCode = 0;
function stop(signal = 'SIGTERM', code = 0) {
  if (stopping) return;
  stopping = true;
  finalCode = code;
  for (const child of children) {
    try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already stopped. */ }
  }
  const timer = setTimeout(() => { for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } process.exit(code); }, 3000);
  timer.unref();
  if (!children.size) process.exit(code);
}
function launch(script, args = [], cwd = root) {
  const child = spawn(process.execPath, [script, ...args], { cwd, stdio: 'inherit', detached: process.platform !== 'win32', env: process.env });
  children.add(child);
  child.on('error', error => { console.error(error.message); stop('SIGTERM', 1); });
  child.on('exit', code => { children.delete(child); if (!stopping) stop('SIGTERM', code || 0); else if (!children.size) process.exit(finalCode); });
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
launch(resolve(root, 'scripts/lab.mjs'));
for (let attempts = 0; attempts < 90; attempts++) {
  if (stopping) break;
  try {
    const response = await fetch('http://127.0.0.1:8787/api/config', { signal: AbortSignal.timeout(750) });
    if (response.ok) { launch(resolve(root, 'portal/scripts/run-framework.mjs'), ['dev', readExecutionProfile() === 'managed-linux' ? '--host' : '--hostname', '127.0.0.1'], resolve(root, 'portal')); break; }
  } catch { /* Wait until contracts are deployed. */ }
  if (attempts === 89) { console.error('Local lab did not become ready.'); stop('SIGTERM', 1); }
  await new Promise(resolve => setTimeout(resolve, 500));
}
