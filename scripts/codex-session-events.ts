// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

interface Event { type?: string; payload?: Record<string, any> }
const eventsOf = (log: string): Event[] => log.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });

/** A rollout starts with its own metadata; later metadata can belong to inherited history. */
export function plannerSession(log: string): string | null {
  const events = eventsOf(log);
  const own = events.find((event) => event.type === 'session_meta')?.payload;
  if (own?.source?.subagent?.thread_spawn?.agent_role !== 'test-planner' || typeof own.id !== 'string') return null;
  const boundary = events.findIndex((event) => event.type === 'event_msg' && event.payload?.type === 'thread_settings_applied' && event.payload.thread_id === own.id);
  if (boundary >= 0) return events.slice(boundary + 1).map((event) => JSON.stringify(event)).join('\n');
  // Older rollouts have no settings marker. A single metadata record has no inherited session
  // to disambiguate; multiple records without a boundary cannot prove the child's own calls.
  if (events.filter((event) => event.type === 'session_meta').length !== 1) throw new Error(`No own-turn boundary for planner session ${own.id}`);
  return events.filter((event) => event.type !== 'session_meta').map((event) => JSON.stringify(event)).join('\n');
}

/** Pair calls only within the supplied session/turn scope, preserving unreturned calls as empty. */
export function toolCalls(log: string): { name: string; output: string }[] {
  const calls = new Map<string, { name: string; output: string }>();
  for (const event of eventsOf(log)) {
    const p = event.payload ?? {};
    if (event.type !== 'response_item') continue;
    if (p.type === 'function_call' || p.type === 'custom_tool_call') calls.set(String(p.call_id), { name: String(p.name), output: '' });
    if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && calls.has(String(p.call_id))) calls.get(String(p.call_id))!.output = String(p.output);
  }
  return [...calls.values()];
}
