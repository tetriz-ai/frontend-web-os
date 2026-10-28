// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Monotonic claim generations fence paused owners. No claim name is reused or deleted.
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FwosError, ownedPath } from '../../kernel/index.ts';
import { FWOS_DIR } from './store.ts';
export const LOCK_TTL_MS = 4 * 60 * 60 * 1000;
export interface LockInfo { session: string; at: string }
interface Claim extends LockInfo { generation: number; owner: string | null; active: boolean; released: boolean; aborted: boolean }
const base = (root: string) => ownedPath(root, `${FWOS_DIR}/local`);
const fresh = (claim: LockInfo, at: Date) => at.getTime() - Date.parse(claim.at) < LOCK_TTL_MS;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function metadata(file: string, fallback: string, at: Date): LockInfo | null {
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as LockInfo;
    if (!info || typeof info.session !== 'string' || !info.session.trim() || typeof info.at !== 'string' || !Number.isFinite(Date.parse(info.at))) throw new Error('invalid owner or timestamp');
    return info;
  } catch (error) {
    // Unknown fresh ownership fails closed; an abandoned partial record can expire.
    try { if (at.getTime() - lstatSync(fallback).mtimeMs >= LOCK_TTL_MS) return null; }
    catch (statError) { if (missing(statError)) return null; throw statError; }
    throw new FwosError(`Unreadable session lock ${file}: ${(error as Error).message}`, 'Wait for its lease to expire or inspect the local lock before retrying.');
  }
}
function claims(root: string, at: Date): Claim[] {
  const local = base(root); const dir = ownedPath(root, `${FWOS_DIR}/local/lock-claims`);
  const out: Claim[] = [];
  const legacy = metadata(join(local, 'lock.json'), join(local, 'lock.json'), at);
  if (legacy) out.push({ ...legacy, generation: 0, owner: null, active: true, released: false, aborted: false });
  let names: string[];
  try { names = readdirSync(dir); } catch (error) { if (missing(error)) return out; throw error; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const generation = Number(name);
    if (!Number.isSafeInteger(generation)) throw new FwosError('Session lock generation is out of range.');
    const link = join(dir, name); const target = readlinkSync(link);
    if (!/^\.\.\/lock-owners\/[0-9a-f-]+$/.test(target)) throw new FwosError(`Unexpected session lock target ${link}.`);
    const owner = ownedPath(root, `${FWOS_DIR}/local/lock-owners/${target.split('/').at(-1)}`); const info = metadata(join(owner, 'claim.json'), link, at);
    if (!info) { out.push({ generation, owner, session: '', at: new Date(0).toISOString(), active: false, released: true, aborted: false }); continue; }
    let newest = info.at;
    for (const heartbeat of readdirSync(owner).filter((name) => /^heartbeat-\d+-[0-9a-f-]+$/.test(name))) {
      const stamp = Number(heartbeat.split('-')[1]);
      if (Number.isFinite(stamp) && stamp > Date.parse(newest)) newest = new Date(stamp).toISOString();
    }
    out.push({ ...info, at: newest, generation, owner, active: existsSync(join(owner, 'active')), released: existsSync(join(owner, 'released')), aborted: existsSync(join(owner, 'aborted')) });
  }
  return out.sort((a, b) => a.generation - b.generation);
}
const latest = (all: Claim[]) => all.filter((claim) => !claim.aborted).at(-1);
const holder = (claim: Claim | undefined, at: Date): LockInfo | null => claim && !claim.released && fresh(claim, at) ? { session: claim.session, at: claim.at } : null;
const mark = (claim: Claim, name: string) => { if (claim.owner && !existsSync(join(claim.owner, name))) { try { writeFileSync(join(claim.owner, name), '', { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } } };
const newer = (all: Claim[], claim: Claim) => all.some((next) => next.generation > claim.generation && !next.aborted);

export function readLock(root: string, at: Date = new Date()): LockInfo | null { return holder(latest(claims(root, at)), at); }

export function acquireLock(root: string, session: string): { ok: true } | { ok: false; holder: LockInfo } {
  for (let attempt = 0; attempt < 16; attempt++) {
    const at = new Date(); const all = claims(root, at); const current = latest(all); const held = holder(current, at);
    if (held && (held.session !== session || !current?.active)) return { ok: false, holder: held };
    if (held && current?.owner && !current.released) {
      mark(current, `heartbeat-${Date.now()}-${randomUUID()}`);
      const after = claims(root, new Date());
      if (!newer(after, current) && !existsSync(join(current.owner, 'released'))) return { ok: true };
      const replacement = holder(latest(after), new Date());
      if (replacement) return { ok: false, holder: replacement };
      continue;
    }
    const dir = ownedPath(root, `${FWOS_DIR}/local/lock-claims`); const owner = ownedPath(root, `${FWOS_DIR}/local/lock-owners/${randomUUID()}`);
    mkdirSync(dir, { recursive: true }); mkdirSync(owner, { recursive: true });
    writeFileSync(join(owner, 'claim.json'), JSON.stringify({ session, at: at.toISOString() }), { flag: 'wx' });
    const generation = Math.max(0, ...all.map((claim) => claim.generation)) + 1;
    try { symlinkSync(`../lock-owners/${owner.split('/').at(-1)}`, join(dir, String(generation))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    const own: Claim = { session, at: at.toISOString(), generation, owner, active: false, released: false, aborted: false };
    const previous = latest(claims(root, new Date()).filter((claim) => claim.generation < generation));
    const before = holder(previous, new Date());
    if (before && (before.session !== session || !previous?.active)) { mark(own, 'aborted'); return { ok: false, holder: before }; }
    mark(own, 'active');
    const after = claims(root, new Date());
    if (!newer(after, own)) return { ok: true };
    mark(own, 'aborted');
    const replacement = holder(latest(after), new Date());
    if (replacement) return { ok: false, holder: replacement };
  }
  throw new FwosError('Session lock contention did not settle.', 'Retry the command.');
}

export function releaseLock(root: string, session: string): boolean {
  const all = claims(root, new Date()); const own = latest(all);
  if (!own || own.released) return true;
  if (own.session !== session) return false;
  if (!own.owner) {
    // Migrate through an exclusive generation; leave the legacy inode untouched.
    if (!acquireLock(root, session).ok) return false;
    return releaseLock(root, session);
  }
  mark(own, 'released');
  return !newer(claims(root, new Date()), own);
}
