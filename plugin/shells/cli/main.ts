// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The `fwos` CLI entry. Bundled into dist/fwos.mjs, which the plugin's hooks and skills run, and
// apps run in CI from their vendored .fwos/cli or a linked clone. The optional CLI archive ships through GitHub Releases. No model calls happen anywhere in it.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FwosError, pluginVersion } from '../../kernel/index.ts';
import { type Args, COMMANDS, FLAGS, HELP, type Io, commandHelp, flagsKey } from './commands.ts';

export { dispatch } from '../hooks/index.ts';

/**
 * Splits argv into positionals and --flags (`--x v`, `--x=v`, bare `--x` is true; repeats collect).
 * `dashed` holds single-dash words such as `-json`, a typo for a flag; after `--` they're positionals.
 */
export function parseArgs(argv: string[]): { command: string | undefined; args: Args; dashed: string[] } {
  const positionals: string[] = [];
  const dashed: string[] = [];
  const flags: Args['flags'] = {};
  const BOOL = new Set(['json', 'staged', 'report', 'check', 'yes', 'red', 'existing', 'init', 'help', 'version']);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const key = t.slice(2, eq === -1 ? undefined : eq);
      let value: string | boolean;
      if (eq !== -1) value = t.slice(eq + 1);
      else if (!BOOL.has(key) && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) value = argv[++i]!;
      else value = true;
      const prev = flags[key];
      flags[key] = prev === undefined ? value : ([] as string[]).concat(prev as string, String(value));
    } else if (t === '-h') flags.help = true;
    else if (/^-[A-Za-z]/.test(t)) dashed.push(t);
    else positionals.push(t);
  }
  const [command, ...rest] = positionals;
  return { command, args: { positionals: rest, flags }, dashed };
}

export async function main(argv: string[], io: Io): Promise<number> {
  const { command, args, dashed } = parseArgs(argv);
  if (dashed.length > 0) {
    io.err(`fwos: unknown flag ${dashed.join(', ')}. fwos flags start with two dashes, such as --json.`);
    return 2;
  }
  if (args.flags.version || command === 'version') {
    io.out(pluginVersion());
    return 0;
  }
  // Before a command, an unknown flag takes the command as its value (`fwos --jsn check`), so
  // nothing would run and the help would exit 0.
  const stray = command ? [] : Object.keys(args.flags).filter((f) => f !== 'help' && f !== 'dir');
  if (stray.length > 0) {
    io.err(`fwos: unknown flag ${stray.map((f) => `--${f}`).join(', ')}, so no command ran. Put a command's flags after it: \`fwos <command> --help\` lists them.`);
    return 2;
  }
  // --help prints help and does nothing else: `fwos scaffold --help` must not scaffold. With a
  // command (`fwos check --help`, `fwos help check`) it prints that command's lines.
  if (!command || command === 'help' || args.flags.help) {
    const [name, sub] = command === 'help' ? args.positionals : [command, args.positionals[0]];
    if (name && !COMMANDS[name]) {
      io.err(`fwos: unknown command "${name}". Run \`fwos help\`.`);
      return 2;
    }
    io.out((name ? commandHelp(name, sub) : null) ?? HELP.replace('{version}', pluginVersion()));
    return 0;
  }
  const run = COMMANDS[command];
  if (!run) {
    io.err(`fwos: unknown command "${command}". Run \`fwos help\`.`);
    return 2;
  }
  const refused = unknownFlags(command, args);
  if (refused) {
    io.err(...refused);
    return 2;
  }
  try {
    return await run(args, io);
  } catch (e) {
    if (e instanceof FwosError) {
      io.err(`fwos: ${e.message}`);
      if (e.hint) io.err(e.hint);
      return 2;
    }
    io.err(`fwos: unexpected error: ${(e as Error).stack ?? String(e)}`);
    return 2;
  }
}

/** The error lines for flags `fwos <command>` doesn't take, or null when it takes them all. */
function unknownFlags(command: string, args: Args): string[] | null {
  // The hook runs inside the host's tool call, where exit 2 would block the call.
  if (command === 'hook') return null;
  const key = flagsKey(command, args.positionals[0]);
  const takes = FLAGS[key] ?? [];
  const unknown = Object.keys(args.flags).filter((f) => f !== 'dir' && !takes.includes(f));
  if (unknown.length === 0) return null;
  const all = [...takes, 'dir'].map((f) => `--${f}`);
  return [
    `fwos: unknown flag${unknown.length === 1 ? '' : 's'} ${unknown.map((f) => `--${f}`).join(', ')} for "fwos ${key}".`,
    `It takes ${all.length === 1 ? 'only --dir' : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`}. \`fwos ${key} --help\` shows how.`,
  ];
}

/**
 * Whether node was given this file to run: the CLI runs then, and never when another script imports
 * it. Both paths are resolved, so the bundle reached through a bin link or the vendored copy counts.
 */
const isEntry = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntry) {
  // `fwos check | head` closes the pipe early; that's the reader's choice, not an error.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
      throw e;
    });
  }
  const io: Io = {
    out: (...l) => process.stdout.write(`${l.join('\n')}\n`),
    err: (...l) => process.stderr.write(`${l.join('\n')}\n`),
    cwd: process.cwd(),
  };
  main(process.argv.slice(2), io).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`fwos: ${String(e)}\n`);
      process.exitCode = 2;
    },
  );
}
