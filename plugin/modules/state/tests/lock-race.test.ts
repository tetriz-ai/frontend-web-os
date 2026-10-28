// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { Worker } from 'node:worker_threads';
import { readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { acquireLock, readLock, releaseLock, LOCK_TTL_MS } from '../lock.ts';
afterAll(cleanupTempProjects);
async function contenders(root: string) {
  const gate = new SharedArrayBuffer(4);
  const module = new URL('../lock.ts', import.meta.url).href;
  const workers = Array.from({ length: 8 }, (_, index) => new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    import(workerData.module).then(({acquireLock})=>{
      parentPort.postMessage({ready:true});
      Atomics.wait(new Int32Array(workerData.gate),0,0);
      parentPort.postMessage({result:acquireLock(workerData.root,workerData.session),session:workerData.session});
    }).catch(error=>{throw error;});`, { eval: true, workerData: { root, module, gate, session: `session-${index}` }, execArgv: ['--experimental-strip-types'] }));
  const results: { result: { ok: boolean }; session: string }[] = [];
  await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => { worker.once('error', reject); worker.once('message', () => resolve()); })));
  const done = workers.map((worker) => new Promise<{ result: { ok: boolean }; session: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  try { results.push(...await Promise.all(done)); } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
  return results;
}
it('grants exactly one synchronized initial claim', async () => {
  const root = tempProject({});
  const all = await contenders(root);
  expect(all.filter((x) => x.result.ok)).toHaveLength(1);
  expect(readLock(root)?.session).toBe(all.find((x) => x.result.ok)!.session);
});
it('serializes stale-lease contenders and an old owner cannot release the replacement', async () => {
  const root = tempProject({}); acquireLock(root, 'old');
  const owner = readlinkSync(join(root, '.fwos/local/lock-claims/1'));
  writeText(join(root, '.fwos/local/lock-claims', owner, 'claim.json'), JSON.stringify({ session: 'old', at: new Date(Date.now() - LOCK_TTL_MS - 1000).toISOString() }));
  const all = await contenders(root);
  expect(all.filter((x) => x.result.ok)).toHaveLength(1);
  expect(releaseLock(root, 'old')).toBe(false);
  expect(readLock(root)?.session).toBe(all.find((x) => x.result.ok)!.session);
});
it('renews the same session and fails closed on fresh malformed legacy records', () => {
  const root = tempProject({});
  expect(acquireLock(root, 'same').ok).toBe(true); expect(acquireLock(root, 'same').ok).toBe(true);
  expect(releaseLock(root, 'other')).toBe(false);
  const broken = tempProject({ '.fwos/local/lock.json': '{' });
  expect(() => acquireLock(broken, 'next')).toThrow(/Unreadable session lock/);
});
it('recovers an expired pending claim without erasing or reusing its generation', () => {
  const root = tempProject({}); acquireLock(root, 'old');
  const owner = readlinkSync(join(root, '.fwos/local/lock-claims/1'));
  writeText(join(root, '.fwos/local/lock-claims', owner, 'claim.json'), JSON.stringify({ session: 'old', at: new Date(Date.now() - LOCK_TTL_MS - 1000).toISOString() }));
  expect(acquireLock(root, 'next').ok).toBe(true);
  expect(releaseLock(root, 'old')).toBe(false);
  expect(readLock(root)?.session).toBe('next');
});

// Pause the actual filesystem operation after the worker has selected its owner. This forces
// the old-owner race, rather than hoping the scheduler happens to interleave the processes.
async function pausedOperation(root: string, session: string, operation: 'renew' | 'release' | 'pending') {
  const gate = new SharedArrayBuffer(4);
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs'); const original=fs.writeFileSync; let paused=false;
    fs.writeFileSync=function(file,...args) {
      const target=String(file);
      const match=workerData.operation==='renew' ? /heartbeat-/.test(target)
        : workerData.operation==='release' ? target.endsWith('/released') : target.endsWith('/active');
      if(match&&!paused) { paused=true; parentPort.postMessage('paused'); Atomics.wait(new Int32Array(workerData.gate),0,0); }
      return original.call(this,file,...args);
    };
    require('node:module').syncBuiltinESMExports();
    import(workerData.module).then(lock=>parentPort.postMessage({result:workerData.operation==='release'
      ? lock.releaseLock(workerData.root,workerData.session) : lock.acquireLock(workerData.root,workerData.session)}));
  `, { eval: true, workerData: { root, session, operation, gate, module: new URL('../lock.ts', import.meta.url).href }, execArgv: ['--experimental-strip-types'] });
  await new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); });
  return { worker, finish: () => new Promise<any>((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  }) };
}
function expire(root: string, generation: number, session: string) {
  const owner = readlinkSync(join(root, `.fwos/local/lock-claims/${generation}`));
  writeText(join(root, '.fwos/local/lock-claims', owner, 'claim.json'), JSON.stringify({ session, at: new Date(Date.now() - LOCK_TTL_MS - 1000).toISOString() }));
}
it.each(['renew', 'release'] as const)('fences a paused old %s after a replacement has acquired', async (operation) => {
  const root = tempProject({}); expect(acquireLock(root, 'old').ok).toBe(true);
  const paused = await pausedOperation(root, 'old', operation);
  try {
    expire(root, 1, 'old'); expect(acquireLock(root, 'replacement').ok).toBe(true);
    const completed = await paused.finish();
    expect(operation === 'renew' ? completed.result.ok : completed.result).toBe(false);
    expect(readLock(root)?.session).toBe('replacement');
    expect(acquireLock(root, 'intruder').ok).toBe(false);
  } finally { await paused.worker.terminate(); }
});
it('blocks behind a fresh pending claim, then recovers after the crashed claimant expires', async () => {
  const root = tempProject({}); const paused = await pausedOperation(root, 'crashed', 'pending');
  expect(readLock(root)?.session).toBe('crashed');
  expect(acquireLock(root, 'contender').ok).toBe(false);
  await paused.worker.terminate();
  expire(root, 1, 'crashed'); expect(acquireLock(root, 'contender').ok).toBe(true);
  expect(readLock(root)?.session).toBe('contender');
});
