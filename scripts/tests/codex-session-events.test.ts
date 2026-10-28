// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { plannerSession, toolCalls } from '../codex-session-events.ts';
const meta = (id: string, role: string) => ({ type: 'session_meta', payload: { id, source: { subagent: { thread_spawn: { agent_role: role } } } } });
const call = (id: string, name: string) => ({ type: 'response_item', payload: { type: 'function_call', call_id: id, name } });
const log = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n');
it('identifies the actual child and discards inherited parent calls', () => {
  const own = plannerSession(log(meta('child', 'test-planner'), meta('parent', 'default'), call('p', 'spawn_agent'), { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: 'child' } }));
  expect(own).not.toBeNull(); expect(toolCalls(own!)).toEqual([]);
});
it('does not identify unrelated sessions by instruction text or inherited role metadata', () => {
  expect(plannerSession(log(meta('parent', 'default'), { type: 'response_item', payload: { text: 'You write a test plan.' } }, meta('child', 'test-planner')))).toBeNull();
});
it('retains a real child call with no denial, so the live guard assertion fails', () => {
  const own = plannerSession(log(meta('child', 'test-planner'), meta('parent', 'default'), { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: 'child' } }, call('own', 'exec_command')))!;
  expect(toolCalls(own)).toEqual([{ name: 'exec_command', output: '' }]);
  expect(toolCalls(own).every((call) => call.output.includes('fwos [tests/planner-sandbox]'))).toBe(false);
});
it('pairs only child outputs with their own calls', () => {
  const own = plannerSession(log(meta('child', 'test-planner'), call('own', 'exec_command'), { type: 'response_item', payload: { type: 'function_call_output', call_id: 'own', output: 'fwos [tests/planner-sandbox]' } }))!;
  expect(toolCalls(own)[0]?.output).toBe('fwos [tests/planner-sandbox]');
});
it('fails closed for older inherited logs without an own-turn marker', () => {
  expect(() => plannerSession(log(meta('child', 'test-planner'), meta('parent', 'default')))).toThrow(/boundary/);
});
