// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The published gallery samples in examples/*/gallery/: what each holds, how the gallery e2e writes
// it from a real run, and how an offline test rebuilds the project a sample came from, so the
// published report stays the one fwos writes for that evidence.

import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GALLERY_SHOTS, FIDELITY_RESULTS, loadProject, pluginVersion, walkFiles, writeText } from '../../../plugin/kernel/index.ts';
import { tempProject } from '../../../plugin/kernel/testing.ts';
import { loadDesignSystem, tokenOutputs } from '../../../plugin/modules/design-system/index.ts';
import { renderTemplate } from '../../../plugin/modules/screens/index.ts';
import { galleryInputs } from '../../../plugin/platforms/web/gallery.ts';
import type { Io } from '../../../plugin/shells/cli/commands.ts';
import { main } from '../../../plugin/shells/cli/main.ts';

export const REPO = new URL('../../../', import.meta.url).pathname;

export interface Sample {
  /** The example folder whose gallery/ the sample fills. */
  example: string;
  /** What the run did, in the order it did it, for the example's README. */
  steps: string[];
}

export const IMPORT_SAMPLE: Sample = {
  example: 'examples/import-a-shadcn-theme',
  steps: [
    'fwos design-system init --from-shadcn globals.css --name "shadcn default"',
    'the contrast correction the example suggests: status.critical.text in light mode set to #e20000',
    'fwos scaffold web, fwos tokens build, pnpm install',
    'fwos design-system gallery, then the comparison it prints',
    'fwos design-system decide status.critical.text --as intentional',
    'fwos design-system report',
  ],
};

export const EMBER_SAMPLE: Sample = {
  example: 'examples/swap-in-a-design-system',
  steps: ['the Ember folder copied to design-system/', 'fwos scaffold web, fwos tokens build, pnpm install', 'fwos design-system gallery, then the comparison it prints', 'fwos design-system report'],
};

/** What a sample folder holds besides the sheets. */
export const SAMPLE_FILES = { report: 'report.md', results: 'results.json', decisions: 'decisions.json', sources: 'source-inputs.json' };
/** One sheet per mode and width: each component's original beside its adopted side. */
export const SHEETS = ['light-desktop.jpg', 'dark-desktop.jpg', 'light-phone.jpg', 'dark-phone.jpg'];

/** The contrast correction the import example's README suggests: the light critical red, nudged to pass 4.5:1. */
export const CORRECTION = { reason: "approved contrast correction: the theme's red was 4.36:1 on its background", by: 'Sample reviewer' };

export function correctContrast(root: string): void {
  const file = join(root, 'design-system/tokens/light.json');
  const light = JSON.parse(readFileSync(file, 'utf8'));
  light.color.status.critical.text = { $value: '#e20000' };
  writeFileSync(file, `${JSON.stringify(light, null, 2)}\n`);
}

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
interface SourceSnapshot {
  schema: 1;
  fwos: string;
  /** Content identity stays verifiable when a release is exported into new Git history. */
  validationSource: string;
  generator: { path: string; sha256: string }[];
  files: Record<string, { sha256: string; content: string }>;
}

/** Source hashes, not a human sign-off. Changes require another actual sample browser run. */
function generatorProvenance(): SourceSnapshot['generator'] {
  const paths = [
    ...walkFiles(join(REPO, 'plugin/modules/screens/templates/web')).map((file) => `plugin/modules/screens/templates/web/${file}`),
    ...walkFiles(join(REPO, 'examples/swap-in-a-design-system/ember')).map((file) => `examples/swap-in-a-design-system/ember/${file}`),
    'examples/import-a-shadcn-theme/globals.css', 'scripts/tests/support/gallery-samples.ts',
    'plugin/platforms/web/gallery.ts', 'plugin/modules/design-system/generate.ts',
    'plugin/modules/design-system/dtcg.ts', 'plugin/modules/design-system/color.ts',
    'plugin/modules/design-system/load.ts', 'plugin/modules/design-system/slots.ts',
  ].sort();
  return paths.map((path) => ({ path, sha256: digest(readFileSync(join(REPO, path))) }));
}

function validSnapshotPath(file: string, content: string): void {
  if (!file || file.includes('\\') || file.includes('\0') || file.startsWith('/') || file.split('/').some((part) => ['..', '.git', '.fwos', 'node_modules', '.next', '.codex', '.claude'].includes(part))) throw new Error(`Unsafe gallery snapshot path: ${file}`);
  const name = file.split('/').at(-1)!;
  if (/^\.env(?:\.|$)/.test(name)) {
    // Only a byte-identical reviewed template placeholder is allowed, never a live env file.
    const template = renderTemplate('web', { APP_NAME: 'Gallery sample', APP_SLUG: 'gallery-sample' }).find((entry) => entry.path === file);
    if (name !== '.env.example' || template?.content !== content) throw new Error(`Credential-bearing gallery input cannot be published: ${file}`);
  }
}

export function snapshotSources(root: string, sample: Sample): SourceSnapshot {
  if (![IMPORT_SAMPLE, EMBER_SAMPLE].includes(sample)) throw new Error('Only the two first-party scaffold gallery samples may publish source snapshots.');
  const project = loadProject(root);
  const files: SourceSnapshot['files'] = {};
  for (const file of galleryInputs(project)) {
    if (lstatSync(join(root, file)).isSymbolicLink()) throw new Error(`Symlink gallery input cannot be published: ${file}`);
    const name = file.split('/').at(-1)!;
    if (/^\.env(?:\.|$)/.test(name) && name !== '.env.example') throw new Error(`Credential-bearing gallery input cannot be published: ${file}`);
    const bytes = readFileSync(join(root, file));
    if (!isUtf8(bytes) || bytes.includes(0)) throw new Error(`Unsupported binary gallery input: ${file}`);
    const content = bytes.toString('utf8'); validSnapshotPath(file, content);
    files[file] = { sha256: digest(bytes), content };
  }
  const generator = generatorProvenance();
  const validationSource = digest(JSON.stringify({ generator, files }));
  return { schema: 1, fwos: pluginVersion(), validationSource, generator, files };
}

export function restoreSources(root: string, snapshot: SourceSnapshot): void {
  if (snapshot.schema !== 1 || snapshot.fwos !== pluginVersion() || JSON.stringify(snapshot.generator) !== JSON.stringify(generatorProvenance())) throw new Error('Gallery sample generator/version changed: rerun the actual browser samples.');
  for (const [file, input] of Object.entries(snapshot.files)) {
    validSnapshotPath(file, input.content);
    if (digest(input.content) !== input.sha256) throw new Error(`Gallery source snapshot byte hash differs: ${file}`);
  }
  if (snapshot.validationSource !== digest(JSON.stringify({ generator: snapshot.generator, files: snapshot.files }))) throw new Error('Gallery source snapshot content identity differs.');
  for (const [file, input] of Object.entries(snapshot.files)) writeText(join(root, file), input.content);
}

/** Copies a run's report, results, decisions and sheets into the example's gallery/ folder. */
export function publish(root: string, sample: Sample): void {
  const out = join(REPO, sample.example, 'gallery');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, SAMPLE_FILES.sources), JSON.stringify(snapshotSources(root, sample), null, 2) + '\n');
  copyFileSync(join(root, 'docs/app/reports/design-system.md'), join(out, SAMPLE_FILES.report));
  copyFileSync(join(root, FIDELITY_RESULTS), join(out, SAMPLE_FILES.results));
  const decisions = join(root, '.fwos/fidelity.json');
  writeFileSync(join(out, SAMPLE_FILES.decisions), existsSync(decisions) ? readFileSync(decisions, 'utf8') : '{\n  "schema": 1,\n  "decisions": []\n}\n');
  for (const sheet of SHEETS) copyFileSync(join(root, GALLERY_SHOTS, sheet), join(out, sheet));
}

async function fwos(cwd: string, ...argv: string[]): Promise<string> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  if (code !== 0) throw new Error(`fwos ${argv.join(' ')} exited ${code}: ${err.join('\n')}`);
  return out.join('\n');
}

/**
 * The project a sample came from, rebuilt with nothing installed: the design system as the run
 * had it, the scaffold's components, the generated token CSS, and the run's decisions and results.
 */
export async function rebuild(sample: Sample): Promise<string> {
  const root = tempProject({ 'globals.css': readFileSync(join(REPO, 'examples/import-a-shadcn-theme/globals.css'), 'utf8') });
  await fwos(root, 'init', '--name', 'Gallery sample');
  if (sample === IMPORT_SAMPLE) {
    await fwos(root, 'design-system', 'init', '--from-shadcn', 'globals.css', '--name', 'shadcn default');
    correctContrast(root);
  } else {
    cpSync(join(REPO, 'examples/swap-in-a-design-system/ember'), join(root, 'design-system'), { recursive: true });
  }
  // The scaffold's components, and its component state fixtures, which the gallery's state cells draw.
  for (const f of renderTemplate('web', { APP_NAME: 'Gallery sample', APP_SLUG: 'gallery-sample' })) {
    if (f.path.startsWith('apps/web/src/shared/ui/') || f.path === 'apps/web/app/layout.tsx' || f.path === 'apps/web/src/screens/components.tsx') writeText(join(root, f.path), f.content);
  }
  const sourceFile = join(REPO, sample.example, 'gallery', SAMPLE_FILES.sources);
  if (!existsSync(sourceFile)) throw new Error(`Gallery source snapshot missing: ${sourceFile}; rerun the actual browser samples.`);
  const snapshot = JSON.parse(readFileSync(sourceFile, 'utf8')) as SourceSnapshot;
  restoreSources(root, snapshot);
  const p = loadProject(root);
  for (const o of tokenOutputs(p, loadDesignSystem(p)!)) writeText(join(root, o.path), o.content);
  const actualInputs = galleryInputs(loadProject(root));
  if (JSON.stringify(actualInputs) !== JSON.stringify(Object.keys(snapshot.files).sort())) throw new Error('Gallery source snapshot inputs differ from the reconstructed project.');
  for (const file of actualInputs) if (digest(readFileSync(join(root, file))) !== snapshot.files[file]!.sha256) throw new Error(`Rebuilt gallery source differs: ${file}`);
  const from = join(REPO, sample.example, 'gallery');
  writeText(join(root, FIDELITY_RESULTS), readFileSync(join(from, SAMPLE_FILES.results), 'utf8'));
  const decisions = JSON.parse(readFileSync(join(from, SAMPLE_FILES.decisions), 'utf8')) as { decisions: unknown[] };
  if (decisions.decisions.length > 0) writeText(join(root, '.fwos/fidelity.json'), readFileSync(join(from, SAMPLE_FILES.decisions), 'utf8'));
  return root;
}
