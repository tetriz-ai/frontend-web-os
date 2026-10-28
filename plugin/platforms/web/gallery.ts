// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The web comparison gallery. It reads what each component's source says it can render (variant
// axes from cva or from union-typed props, states from props and state classes, interactions from
// elements, Radix primitives and classes), writes a dev-only route into the app that renders both
// sides of every component, and a Playwright runner that compares them in Chromium: computed
// styles at rest, hovered, focused and open, and what each interaction does, in each mode at each
// width. Every check skips the folder it writes (ALWAYS_SKIPPED).

import { posix } from 'node:path';
import {
  type ComponentFacts,
  FIDELITY_RESULTS,
  GALLERY_ROUTE,
  GALLERY_SHOTS,
  type GalleryAdapter,
  type GalleryCell,
  type GalleryInteraction,
  type GalleryModel,
  type GeneratedFile,
  type Project,
  type SourcedName,
  extractImportBindings,
  galleryHash,
  hashFile,
  revisionInputs,
  isTestFile,
  matchAny,
  hashText,
  isDir,
  lexSource,
  sourceKind,
} from '../../kernel/index.ts';
import { webApp } from './adapters.ts';

const SCRIPT = /\.[cm]?[jt]sx?$/;

/** The text of a component: its file, or for a folder its index (else every script file in it). */
function sourceOf(project: Project, file: string): string {
  if (SCRIPT.test(file)) return project.read(file) ?? '';
  for (const name of ['index.tsx', 'index.ts', 'index.jsx', 'index.js']) {
    const text = project.read(posix.join(file, name));
    if (text !== null) return text;
  }
  return project
    .files([`${file}/**`])
    .filter((f) => SCRIPT.test(f))
    .map((f) => project.read(f) ?? '')
    .join('\n');
}

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const isPascal = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name);

/** A source file, lexed once: comments blanked, and strings blanked too for reading its structure. */
interface Read {
  src: string;
  /** Comments blanked. */
  masked: string;
  /** Comments and string contents blanked, so braces and keys in strings don't count. */
  shape: string;
  strings: ReturnType<typeof lexSource>['strings'];
  /** The text of every string in the file. */
  texts: string[];
}

function read(file: string, src: string): Read {
  const { masked, strings } = lexSource(src, sourceKind(file) ?? 'jsx');
  const shape = masked.split('');
  for (const s of strings) shape.fill(' ', s.open + 1, s.closed ? s.close : s.close + 1);
  const texts = strings.map((s) => s.runs.map(([a, b]) => src.slice(a, b)).join(' '));
  return { src, masked, shape: shape.join(''), strings, texts };
}

const DECLARED = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s+(type\s+)?\{([^}]*)\}/g;

/** Every exported name in the order it appears, the ones that are types, and the default one. */
function exportsOf(r: Read): { names: string[]; types: Set<string>; defaultName?: string } {
  const found: [number, string][] = [];
  const types = new Set<string>();
  let defaultName: string | undefined;
  for (const m of r.shape.matchAll(DECLARED)) {
    found.push([m.index!, m[2]!]);
    if (m[1] === 'interface' || m[1] === 'type') types.add(m[2]!);
    if (/^export\s+(?:declare\s+)?default\b/.test(m[0])) defaultName = m[2]!;
  }
  // `export default Name;` after the declaration.
  const late = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(r.shape);
  if (late && !['function', 'class', 'async', 'abstract'].includes(late[1]!)) {
    defaultName = late[1]!;
    found.push([late.index, late[1]!]);
  }
  for (const m of r.shape.matchAll(EXPORT_LIST)) {
    m[2]!.split(',').forEach((part, i) => {
      const words = part.trim().split(/\s+/);
      const isType = !!m[1] || words[0] === 'type';
      const name = words.filter((w) => w !== 'type').at(-1);
      if (!name) return;
      found.push([m.index! + i / 1000, name]);
      if (isType) types.add(name);
    });
  }
  // A name the file declares as a type is a type, wherever it is exported.
  for (const m of r.shape.matchAll(/\b(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) types.add(m[1]!);
  const names = [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, n]) => n))];
  return { names, types, ...(defaultName ? { defaultName } : {}) };
}

/** The string at offset `at` (its opening quote), or null. */
function stringAt(r: Read, at: number): string | null {
  const s = r.strings.find((x) => x.open === at);
  return s ? s.runs.map(([a, b]) => r.src.slice(a, b)).join('') : null;
}

/** The offset of the brace that closes the one at `open`, read on the shape. */
function closeOf(shape: string, open: number): number {
  let depth = 0;
  for (let i = open; i < shape.length; i++) {
    const c = shape[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The keys of an object literal whose brace is at `open`, each with where its value starts. */
function keysOf(r: Read, open: number): { key: string; value: number }[] {
  const end = closeOf(r.shape, open);
  const out: { key: string; value: number }[] = [];
  let i = open + 1;
  while (i < end) {
    while (i < end && /[\s,]/.test(r.shape[i]!)) i++;
    if (i >= end) break;
    let key: string | null = null;
    const quote = r.src[i];
    if (quote === '"' || quote === "'") {
      key = stringAt(r, i);
      const s = r.strings.find((x) => x.open === i);
      i = s ? s.close + 1 : i + 1;
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(r.shape.slice(i, end));
      if (!m) break;
      key = m[0];
      i += m[0].length;
    }
    while (i < end && /\s/.test(r.shape[i]!)) i++;
    if (r.shape[i] !== ':') break;
    i++;
    while (i < end && /\s/.test(r.shape[i]!)) i++;
    out.push({ key: key!, value: i });
    // Skip the value: up to the next comma at this depth.
    let depth = 0;
    for (; i < end; i++) {
      const c = r.shape[i]!;
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) break;
    }
  }
  return out;
}

type Axis = ComponentFacts['variants'][number];

/** Variant axes from `cva(...)` or `tv(...)`: `variants: { variant: {...}, size: {...} }`, with `defaultVariants`. */
function cvaAxes(r: Read): Axis[] {
  const call = /\b(?:cva|tv)\s*\(/.exec(r.shape);
  if (!call) return [];
  const end = closeOf(r.shape, call.index + call[0].length - 1);
  const body = r.shape.slice(0, end);
  const at = (key: string) => {
    const m = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(body.slice(call.index));
    return m ? call.index + m.index + m[0].length - 1 : -1;
  };
  const variants = at('variants');
  if (variants === -1) return [];
  const defaults = new Map<string, string>();
  const dv = at('defaultVariants');
  if (dv !== -1) for (const { key, value } of keysOf(r, dv)) defaults.set(key, stringAt(r, value) ?? r.shape.slice(value).match(/^[\w-]+/)?.[0] ?? '');
  const axes: Axis[] = [];
  for (const { key, value } of keysOf(r, variants)) {
    if (r.shape[value] !== '{') continue;
    const values = keysOf(r, value).map((k) => k.key);
    if (values.length === 0) continue;
    const def = defaults.get(key) && values.includes(defaults.get(key)!) ? defaults.get(key)! : values[0]!;
    axes.push({ name: key, values: [def, ...values.filter((v) => v !== def)], default: def, from: 'cva variants' });
  }
  return axes;
}

/** String-literal unions a type alias names: `type Tone = 'neutral' | 'brand'`. */
function unionAliases(r: Read): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /\btype\s+([A-Z][\w$]*)\s*=\s*/g;
  for (const m of r.shape.matchAll(re)) {
    const values: string[] = [];
    let i = m.index! + m[0].length;
    for (;;) {
      while (/[\s|]/.test(r.shape[i] ?? '')) i++;
      const v = stringAt(r, i);
      if (v === null) break;
      values.push(v);
      i = r.strings.find((x) => x.open === i)!.close + 1;
      while (/\s/.test(r.shape[i] ?? '')) i++;
      if (r.shape[i] !== '|') break;
    }
    if (values.length >= 2 && /^[\s;]/.test(r.shape[i] ?? ';')) out.set(m[1]!, values);
  }
  return out;
}

/** Axes from props typed with a string union, `variant?: ButtonVariant` or `kind: 'zero' | 'filtered'`, with the default the function gives. */
function propAxes(r: Read): Axis[] {
  const aliases = unionAliases(r);
  const axes: Axis[] = [];
  const seen = new Set<string>();
  for (const m of r.shape.matchAll(/(?<![\w$.])([a-z][\w$]*)\??\s*:\s*/g)) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    let i = m.index! + m[0].length;
    let values: string[] | null = null;
    let from = '';
    const alias = /^[A-Z][\w$]*/.exec(r.shape.slice(i));
    if (alias && aliases.has(alias[0]) && !/^[\w$<.[]/.test(r.shape.slice(i + alias[0].length))) {
      values = aliases.get(alias[0])!;
      from = `type ${alias[0]}`;
    } else {
      const inline: string[] = [];
      for (;;) {
        const v = stringAt(r, i);
        if (v === null) break;
        inline.push(v);
        i = r.strings.find((x) => x.open === i)!.close + 1;
        while (/\s/.test(r.shape[i] ?? '')) i++;
        if (r.shape[i] !== '|') break;
        i++;
        while (/\s/.test(r.shape[i] ?? '')) i++;
      }
      if (inline.length >= 2) {
        values = inline;
        from = `prop ${name}`;
      }
    }
    if (!values) continue;
    seen.add(name);
    // The default a destructuring gives it: `variant = 'primary'`.
    const d = new RegExp(`[{,]\\s*${name}\\s*=\\s*`).exec(r.shape);
    const given = d ? stringAt(r, d.index + d[0].length) : null;
    const def = given && values.includes(given) ? given : values[0]!;
    axes.push({ name, values: [def, ...values.filter((v) => v !== def)], default: def, from });
  }
  return axes;
}

/**
 * Props that set a state, by the names a component spells them and the type they must have: an
 * `error?: string` is a field's message, while StateHandler's `error` object is not.
 */
const STATE_PROPS: [prop: string, type: string, state: string][] = [
  ['loading', 'boolean', 'loading'],
  ['disabled', 'boolean', 'disabled'],
  ['error', 'string', 'invalid'],
  ['invalid', 'boolean', 'invalid'],
  ['checked', 'boolean', 'checked'],
  ['open', 'boolean', 'open'],
  ['selected', 'boolean', 'selected'],
];

/** Props a component may take straight from the element it renders, so destructuring them is enough. */
const NATIVE_STATES = new Set(['loading', 'disabled']);

/** Class variants that style a state of the element itself (not a peer's or a group's). */
const STATE_CLASSES: [RegExp, string][] = [
  [/(?<![\w-])disabled:/, 'disabled'],
  [/(?<![\w-])(?:aria-invalid|invalid):/, 'invalid'],
  [/(?<![\w-])aria-busy:/, 'loading'],
  [/(?<![\w-])(?:data-\[state=checked\]|aria-checked|checked):/, 'checked'],
  [/(?<![\w-])(?:data-\[state=open\]|aria-expanded|open):/, 'open'],
  [/(?<![\w-])(?:data-\[state=active\]|aria-selected):/, 'selected'],
];

const INTERACTION_CLASSES: [RegExp, GalleryInteraction][] = [
  [/(?<![\w-])hover:/, 'hover'],
  [/(?<![\w-])(?:focus-visible|focus-within|focus):/, 'focus'],
  [/(?<![\w-])active:/, 'press'],
];

/** Radix primitives and what a person does with each. */
const RADIX: [RegExp, GalleryInteraction][] = [
  [/^(?:dropdown-menu|context-menu|menubar|dialog|alert-dialog|popover|hover-card|tooltip|select|navigation-menu|accordion|collapsible|DropdownMenu|ContextMenu|Menubar|Dialog|AlertDialog|Popover|HoverCard|Tooltip|Select|NavigationMenu|Accordion|Collapsible)$/, 'open'],
  [/^(?:radio-group|checkbox|switch|toggle|toggle-group|RadioGroup|Checkbox|Switch|Toggle|ToggleGroup)$/, 'check'],
  [/^(?:slider|tabs|Slider|Tabs)$/, 'press'],
];

/** The class variant a pattern found in the file's strings, as `class disabled:`, or null. */
const classFrom = (texts: string[], re: RegExp) => {
  for (const t of texts) {
    const m = re.exec(t);
    if (m) return `class ${m[0]}`;
  }
  return null;
};

function interactionsOf(file: string, r: Read): SourcedName[] {
  const out: SourcedName[] = [];
  const add = (name: GalleryInteraction, from: string) => {
    if (!out.some((x) => x.name === name)) out.push({ name, from });
  };
  const native = (tag: string) => new RegExp(`<${tag}[\\s>/]|ComponentProps(?:WithRef|WithoutRef)?<\\s*['"]${tag}['"]\\s*>|${tag === 'button' ? 'Button' : tag === 'input' ? 'Input' : 'TextArea'}HTMLAttributes`).test(r.masked);
  if (native('button')) add('press', /<button[\s>/]/.test(r.masked) ? '<button>' : 'props of <button>');
  else {
    const handler = /\b(on(?:Click|Press|Retry))\??\s*[:=(]/.exec(r.shape);
    if (handler) add('press', `prop ${handler[1]}`);
  }
  if (native('input') || native('textarea')) add('type', /<(?:input|textarea)[\s>/]/.test(r.masked) ? '<input>' : 'props of <input>');
  for (const imp of extractImportBindings(r.src, sourceKind(file) ?? 'jsx')) {
    const pkg = /^@radix-ui\/react-([\w-]+)$/.exec(imp.spec);
    if (pkg) {
      const hit = RADIX.find(([re]) => re.test(pkg[1]!));
      if (hit) add(hit[1], imp.spec);
    } else if (imp.spec === 'radix-ui') {
      for (const n of imp.names) {
        const hit = RADIX.find(([re]) => re.test(n));
        if (hit) add(hit[1], `radix-ui ${n}`);
      }
    }
  }
  for (const [re, name] of INTERACTION_CLASSES) {
    const from = classFrom(r.texts, re);
    if (from) add(name, from);
  }
  return out;
}

function statesOf(r: Read, declared: string[], axes: Axis[]): { states: SourcedName[]; propOf: Map<string, string> } {
  const found = new Map<string, string>();
  const propOf = new Map<string, string>();
  for (const [prop, type, state] of STATE_PROPS) {
    // A member of a props type (`loading?: boolean`), or for a native one a name the function destructures (`{ disabled, ...}`).
    const member = new RegExp(`(?<![\\w$.])${prop}\\??\\s*:\\s*${type}\\b`).test(r.shape);
    const destructured = NATIVE_STATES.has(prop) && new RegExp(`[{,]\\s*${prop}\\s*(?:=[^,}]*)?[,}]`).test(r.shape);
    if ((member || destructured) && !found.has(state)) {
      found.set(state, `prop ${prop}`);
      propOf.set(state, prop);
    }
  }
  for (const [re, state] of STATE_CLASSES) {
    if (found.has(state)) continue;
    const from = classFrom(r.texts, re);
    if (from) found.set(state, from);
  }
  const axisOf = (s: string) => axes.find((a) => a.values.includes(s));
  const states: SourcedName[] = [];
  for (const s of declared) {
    const axis = axisOf(s);
    states.push({ name: s, from: found.get(s) ?? (axis ? `variant ${axis.name}` : 'components.json') });
  }
  for (const [s, from] of found) if (!declared.includes(s)) states.push({ name: s, from });
  return { states, propOf };
}

// ---- recipes ----------------------------------------------------------------------------------

/**
 * How a recipe renders one cell: the component names it may use (each mapped to its alias), the
 * cell's attributes, its press handler, whether the file exports a part, and the cell itself.
 */
type Render = (n: (name: string) => string, attrs: string, press: string, has: (name: string) => boolean, cell: GalleryCell) => string;

/** A button's label: an icon-sized one gets one character, so it doesn't spill out. */
const buttonText = (cell: GalleryCell) => (/icon/.test(String(cell.props.size ?? '')) ? '+' : 'Button');

interface Recipe {
  /** The exports it needs: without them the component renders generically. */
  needs: string[];
  render: Render;
}

const FWOS: Record<string, Recipe> = {
  button: { needs: ['Button'], render: (n, a, p, _h, c) => `<${n('Button')}${a} onClick={${p}}>${buttonText(c)}</${n('Button')}>` },
  'text-field': { needs: ['TextField'], render: (n, a) => `<${n('TextField')} label="Label" hint="A hint under the field"${a} />` },
  card: { needs: ['Card'], render: (n, a) => `<${n('Card')}${a}>Card content</${n('Card')}>` },
  badge: { needs: ['Badge'], render: (n, a) => `<${n('Badge')}${a}>Badge</${n('Badge')}>` },
  alert: { needs: ['Alert'], render: (n, a) => `<${n('Alert')} title="Alert title"${a}>What happened, and what to do next.</${n('Alert')}>` },
  skeleton: { needs: ['Skeleton'], render: (n, a) => `<div style={{ width: 160 }}><${n('Skeleton')}${a} /></div>` },
  spinner: { needs: ['Spinner'], render: (n, a) => `<${n('Spinner')}${a} />` },
  'empty-state': { needs: ['EmptyState'], render: (n, a) => `<${n('EmptyState')} title="Nothing here yet"${a}>What to do next.</${n('EmptyState')}>` },
  'state-handler': {
    needs: ['StateHandler'],
    render: (n, a, p) => `<${n('StateHandler')} label="items"${a} error={{ message: 'The request timed out.', onRetry: ${p} }}>Content</${n('StateHandler')}>`,
  },
};

const part = (has: (name: string) => boolean, n: (name: string) => string, name: string, inner: string) => (has(name) ? `<${n(name)}>${inner}</${n(name)}>` : '');

const SHADCN: Record<string, Recipe> = {
  button: FWOS.button!,
  input: { needs: ['Input'], render: (n, a) => `<${n('Input')} aria-label="Input" placeholder="Placeholder"${a} />` },
  textarea: { needs: ['Textarea'], render: (n, a) => `<${n('Textarea')} aria-label="Text" placeholder="Placeholder"${a} />` },
  label: { needs: ['Label'], render: (n, a) => `<${n('Label')}${a}>Label</${n('Label')}>` },
  badge: FWOS.badge!,
  card: {
    needs: ['Card'],
    render: (n, a, _p, has) =>
      `<${n('Card')}${a}>${has('CardHeader') ? `<${n('CardHeader')}>${part(has, n, 'CardTitle', 'Card title')}${part(has, n, 'CardDescription', 'A line that describes it')}</${n('CardHeader')}>` : ''}${has('CardContent') ? part(has, n, 'CardContent', 'Card content') : 'Card content'}${part(has, n, 'CardFooter', 'Footer')}</${n('Card')}>`,
  },
  alert: {
    needs: ['Alert'],
    render: (n, a, _p, has) => `<${n('Alert')}${a}>${part(has, n, 'AlertTitle', 'Alert title')}${has('AlertDescription') ? part(has, n, 'AlertDescription', 'What happened.') : 'What happened.'}</${n('Alert')}>`,
  },
  avatar: { needs: ['Avatar'], render: (n, a, _p, has) => `<${n('Avatar')}${a}>${part(has, n, 'AvatarFallback', 'AB')}</${n('Avatar')}>` },
  'dropdown-menu': {
    needs: ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem'],
    // A variant here is the item's (shadcn's destructive item), so the cell's props go on the second item.
    render: (n, a) =>
      `<${n('DropdownMenu')} modal={false}><${n('DropdownMenuTrigger')}>Open menu</${n('DropdownMenuTrigger')}><${n('DropdownMenuContent')}><${n('DropdownMenuItem')}>First item</${n('DropdownMenuItem')}><${n('DropdownMenuItem')}${a}>Second item</${n('DropdownMenuItem')}></${n('DropdownMenuContent')}></${n('DropdownMenu')}>`,
  },
  'radio-group': {
    needs: ['RadioGroup', 'RadioGroupItem'],
    render: (n, a) => `<${n('RadioGroup')} defaultValue="a" aria-label="Options"${a}><${n('RadioGroupItem')} value="a" aria-label="Option A" /><${n('RadioGroupItem')} value="b" aria-label="Option B" /></${n('RadioGroup')}>`,
  },
  checkbox: { needs: ['Checkbox'], render: (n, a) => `<${n('Checkbox')} aria-label="Checkbox"${a} />` },
  switch: { needs: ['Switch'], render: (n, a) => `<${n('Switch')} aria-label="Switch"${a} />` },
  separator: { needs: ['Separator'], render: (n, a) => `<div style={{ width: 160 }}><${n('Separator')}${a} /></div>` },
  skeleton: FWOS.skeleton!,
};

/** The recipe that renders a component: fwos's own, shadcn's, or none (`generic`). */
function recipeFor(id: string, source: string | undefined, r: Read, exported: Set<string>): string {
  const fits = (recipe: Recipe | undefined) => !!recipe && recipe.needs.every((x) => exported.has(x));
  if (source === 'fwos' && fits(FWOS[id])) return `fwos:${id}`;
  if ((source === 'shadcn' || /\bdata-slot\s*=/.test(r.masked)) && fits(SHADCN[id])) return `shadcn:${id}`;
  if (fits(FWOS[id]) && source === undefined && /from\s+['"]@\/shared\/lib['"]/.test(r.masked)) return `fwos:${id}`;
  return 'generic';
}

/** What sets a state through props, or null when only an interaction shows it. */
function stateProps(state: string, propOf: Map<string, string>): Record<string, string | boolean> | null {
  const prop = propOf.get(state);
  if (state === 'invalid') return prop === 'error' ? { error: 'Check this value' } : prop ? { [prop]: true } : { 'aria-invalid': true };
  if (state === 'disabled' || state === 'loading') return { [prop ?? state]: true };
  return null;
}

/** What `describe` returns for a component, given its declared states. */
export function describeComponent(project: Project, item: { id: string; file: string; source?: string }, declared: string[]): ComponentFacts {
  const src = sourceOf(project, item.file);
  const r = read(SCRIPT.test(item.file) ? item.file : `${item.file}/index.tsx`, src);
  const { names, types, defaultName } = exportsOf(r);
  const main = names.find((n) => kebab(n) === item.id && !types.has(n));
  const components = [...(main ? [main] : []), ...names.filter((n) => n !== main && isPascal(n) && !types.has(n))];
  const cva = cvaAxes(r);
  const variants = cva.length > 0 ? cva : propAxes(r);
  const interactions = interactionsOf(item.file, r);
  const { states, propOf } = statesOf(r, declared, variants);
  const recipe = recipeFor(item.id, item.source, r, new Set(names));

  const base: Record<string, string | boolean> = Object.fromEntries(variants.map((v) => [v.name, v.default]));
  const acts = interactions.map((i) => i.name as GalleryInteraction);
  // A declared state that is a variant value, such as a critical alert, is that variant's cell.
  const shownBy = (value: string) => (states.some((s) => s.name === value) ? [value] : []);
  const cells: GalleryCell[] = [{ id: 'default', props: { ...base }, states: [...shownBy('default'), ...variants.flatMap((v) => shownBy(v.default))], interactions: acts }];
  for (const v of variants) {
    for (const value of v.values.slice(1)) cells.push({ id: `${v.name}=${value}`, props: { ...base, [v.name]: value }, states: shownBy(value), interactions: acts });
  }
  const covered = new Set(cells.flatMap((c) => c.states));
  const unrendered: string[] = [];
  for (const s of states) {
    if (s.name === 'default' || covered.has(s.name)) continue;
    // Open and checked are what the open and check interactions show.
    if ((s.name === 'open' && acts.includes('open')) || (s.name === 'checked' && acts.includes('check'))) continue;
    const props = stateProps(s.name, propOf);
    if (!props) {
      unrendered.push(s.name);
      continue;
    }
    cells.push({ id: `state=${s.name}`, props: { ...base, ...props }, states: [s.name], interactions: acts });
    covered.add(s.name);
  }
  return { id: item.id, file: item.file, exports: names, ...(defaultName ? { defaultExport: defaultName } : {}), components, variants, states, interactions, recipe, cells, unrendered };
}

// ---- the files --------------------------------------------------------------------------------

/** Where the gallery goes in the app, and where the app's routes are. */
function placeOf(project: Project): { app: string; routes: string; folder: string } | null {
  const app = webApp(project);
  const routes = [posix.join(app, 'app'), posix.join(app, 'src/app')].find((r) => isDir(project.abs(r)));
  if (!routes) return null;
  return { app, routes, folder: posix.join(routes, '(fwos-screens)/fwos-screens/fwos-gallery') };
}

const rel = (from: string, to: string) => {
  const r = posix.relative(from, to);
  return r.startsWith('.') ? r : `./${r}`;
};

const HEADER = (what: string) => `/* generated by fwos, do not edit. source: design-system/. ${what} Run \`fwos design-system gallery\` to refresh it. */`;

/** JSX attributes for a cell's props: strings quoted, booleans as expressions. */
function attrs(props: Record<string, string | boolean>): string {
  return Object.entries(props)
    .map(([k, v]) => (typeof v === 'boolean' ? ` ${k}={${v}}` : ` ${k}=${JSON.stringify(v)}`))
    .join('');
}

/** The import specifier for a component's file, through the barrel its folder has when that barrel exports it. */
function specifierOf(project: Project, folder: string, file: string): string {
  const dir = posix.dirname(file);
  const base = posix.basename(file).replace(SCRIPT, '');
  for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
    const barrel = project.read(posix.join(dir, name));
    if (barrel !== null && new RegExp(`from\\s+['"]\\./${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(barrel)) return rel(folder, dir);
  }
  return rel(folder, SCRIPT.test(file) ? posix.join(dir, base) : file);
}

const alias = (name: string, id: string) => `${name}_${id.replace(/\W/g, '_')}`;

/**
 * The app's own component state fixtures, when it has them: the `componentStates` the screens browser
 * renders at /fwos-screens/components/<id>, which the scaffold writes in src/screens/components.tsx.
 */
function fixturesOf(project: Project): string | null {
  for (const name of ['components.tsx', 'components.ts']) {
    const file = posix.join(webApp(project), 'src/screens', name);
    if (/\bexport\s+const\s+componentStates\b/.test(project.read(file) ?? '')) return file;
  }
  return null;
}

/** The client component that renders every cell of every component on one side. */
function frameFile(project: Project, folder: string, model: GalleryModel): string {
  /** Per import specifier, the `Name as Alias` each cell uses from it, and the alias its default export takes. */
  const imports = new Map<string, Set<string>>();
  const defaults = new Map<string, string>();
  const sides: Record<'original' | 'adopted', string[]> = { original: [], adopted: [] };
  const states: Record<'original' | 'adopted', string[]> = { original: [], adopted: [] };
  const fixtures = fixturesOf(project);
  for (const entry of model.components) {
    // One definition of a component in a state: where both sides render the same component, a state cell is the app's own fixture.
    const own = !!fixtures && (entry.kind === 'starter' || entry.kind === 'reused');
    for (const side of ['original', 'adopted'] as const) {
      const f = entry[side];
      if (!f) continue;
      const spec = specifierOf(project, folder, f.file);
      const used = imports.get(spec) ?? new Set<string>();
      imports.set(spec, used);
      const [kind, id] = f.recipe.split(':');
      const recipe = kind === 'fwos' ? FWOS[id!] : kind === 'shadcn' ? SHADCN[id!] : undefined;
      const exported = new Set(f.exports);
      const n = (name: string) => {
        // A default export is imported as the default, unless a barrel re-exports it by name.
        if (name === f.defaultExport && spec.endsWith(posix.basename(f.file).replace(SCRIPT, ''))) defaults.set(spec, alias(name, f.id));
        else used.add(`${name} as ${alias(name, f.id)}`);
        return alias(name, f.id);
      };
      const has = (name: string) => exported.has(name);
      const main = f.components[0];
      // Something you type in is a void element: it takes no children.
      const voidLike = f.interactions.some((i) => i.name === 'type');
      const lines = f.cells.map((cell) => {
        const press = `pressed(${JSON.stringify(`${f.id}/${cell.id}`)})`;
        const a = attrs(cell.props);
        const body = recipe
          ? recipe.render(n, a, press, has, cell)
          : main
            ? voidLike
              ? `<${n(main)}${a} />`
              : `<${n(main)}${a}>Example</${n(main)}>`
            : `<span>${f.id} exports no component to render</span>`;
        const state = cell.states.find((x) => x !== 'default');
        return own && state ? `      ${JSON.stringify(cell.id)}: () => own(${JSON.stringify(entry.id)}, ${JSON.stringify(state)}) ?? (${body}),` : `      ${JSON.stringify(cell.id)}: () => ${body},`;
      });
      sides[side].push(`    ${JSON.stringify(entry.id)}: {`, ...lines, '    },');
      const shown = f.cells.filter((c) => c.states.length > 0).map((c) => `${JSON.stringify(c.id)}: ${JSON.stringify(c.states)}`);
      states[side].push(`    ${JSON.stringify(entry.id)}: { ${shown.join(', ')} },`);
    }
  }
  // The fixtures' own file, not the screens barrel, which would bring the screens registry into this client frame.
  if (fixtures) imports.set(rel(folder, fixtures.replace(SCRIPT, '')), new Set(['componentStates as FIXTURES']));
  const importLines = [...imports]
    .filter(([spec, used]) => used.size > 0 || defaults.has(spec))
    .map(([spec, used]) => {
      const named = used.size > 0 ? `{ ${[...used].sort().join(', ')} }` : '';
      return `import ${[defaults.get(spec), named].filter(Boolean).join(', ')} from '${spec}';`;
    });
  return [
    HEADER('The cells of every component, on each side.'),
    '// @ts-nocheck',
    '/* eslint-disable */',
    "'use client';",
    '',
    "import { type ReactNode, useEffect } from 'react';",
    ...importLines,
    '',
    'type Cell = () => ReactNode;',
    '',
    '/** Records a press, so the comparison can tell a click that fires from one that does nothing. */',
    'const pressed = (id: string) => () => {',
    '  const w = window as unknown as { __fwosPresses?: string[] };',
    '  w.__fwosPresses = [...(w.__fwosPresses ?? []), id];',
    '};',
    '',
    ...(fixtures
      ? [
          "/** The app's own fixture for a component in a state, when it has one: the one the screens browser renders. */",
          'const own = (component: string, state: string): ReactNode => FIXTURES?.[component]?.[state]?.() ?? null;',
          '',
        ]
      : []),
    'const CELLS: Record<string, Record<string, Record<string, Cell>>> = {',
    '  original: {',
    ...sides.original,
    '  },',
    '  adopted: {',
    ...sides.adopted,
    '  },',
    '};',
    '',
    '/** The states each cell shows, by the names the registry uses: a cell that shows one is a state fixture. */',
    'const STATES: Record<string, Record<string, Record<string, string[]>>> = {',
    '  original: {',
    ...states.original,
    '  },',
    '  adopted: {',
    ...states.adopted,
    '  },',
    '};',
    '',
    '/**',
    ' * One side of one component: every cell, on the side\'s base surface, in the mode it was asked for.',
    " * With `state`, only the cell that shows it, alone, in the container fwos's state harness reads.",
    ' */',
    'export function Frame({ side, component, mode, dark, state }: { side: string; component: string; mode: string; dark: boolean; state?: string }) {',
    '  useEffect(() => {',
    '    const html = document.documentElement;',
    "    html.setAttribute('data-theme', mode);",
    "    html.classList.toggle('dark', dark);",
    "    html.style.colorScheme = dark ? 'dark' : 'light';",
    "    html.setAttribute('data-fwos-ready', '1');",
    '  }, [mode, dark]);',
    '  const cells = CELLS[side]?.[component];',
    '  const shows = STATES[side]?.[component] ?? {};',
    '  if (state !== undefined) {',
    "    const id = Object.keys(cells ?? {}).find((c) => shows[c]?.includes(state)) ?? (state === 'default' && cells?.default ? 'default' : undefined);",
    '    return id ? (',
    '      <div data-fwos-fixture={`component:${component}`} data-fwos-state={state}>',
    '        {cells[id]()}',
    '      </div>',
    '    ) : (',
    '      <div data-fwos-fixture={`component:${component}`} data-fwos-state={state} data-fwos-missing="">',
    '        No cell of {component} renders {state}.',
    '      </div>',
    '    );',
    '  }',
    "  if (!cells) return <p data-fwos-gallery-missing=\"\">Nothing renders on this side.</p>;",
    '  return (',
    '    <div',
    '      data-fwos-gallery={component}',
    '      data-fwos-side={side}',
    "      style={{ background: 'var(--fwos-gallery-bg)', color: 'var(--fwos-gallery-fg)', padding: 24, display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}",
    '    >',
    '      {Object.entries(cells).map(([id, render]) => (',
    "        <figure key={id} data-fwos-cell={id} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '100%' }}>",
    "          <figcaption style={{ font: '12px/16px ui-monospace, monospace', opacity: 0.6 }}>{id}</figcaption>",
    '          <div data-fwos-render="" data-fwos-fixture={shows[id] ? `component:${component}` : undefined} data-fwos-state={shows[id]?.[0]}>',
    '            {render()}',
    '          </div>',
    '        </figure>',
    '      ))}',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
}

/** The dev-only page: the side-by-side index, or one side of one component in one mode. */
function pageFile(): string {
  return [
    HEADER('The dev-only gallery page.'),
    '// @ts-nocheck',
    '/* eslint-disable */',
    "import { notFound } from 'next/navigation';",
    "import data from './gallery.json';",
    "import { Frame } from './frame';",
    '',
    "export const dynamic = 'force-dynamic';",
    '',
    "// Dev-only, like /fwos-screens: it 404s in production unless FWOS_SCREENS=1.",
    "const enabled = () => process.env.NODE_ENV === 'development' || process.env.FWOS_SCREENS === '1';",
    '',
    'export default async function Gallery({ searchParams }) {',
    '  if (!enabled()) notFound();',
    '  const q = (await searchParams) ?? {};',
    '  const mode = data.modes.includes(q.mode) ? q.mode : data.modes[0];',
    "  // One component in one state, on the adopted side: a state fixture fwos's harness and `fwos doctor --start` render.",
    '  if (q.fixture) {',
    '    const vars = data.variables.adopted[mode] ?? {};',
    "    const css = ':root:root:root{' + Object.entries(vars).map(([k, v]) => k + ':' + v).join(';') + '}';",
    '    return (',
    '      <>',
    '        <style dangerouslySetInnerHTML={{ __html: css }} />',
    "        <Frame side=\"adopted\" component={q.fixture} mode={mode} dark={mode === data.dark} state={q.state ?? 'default'} />",
    '      </>',
    '    );',
    '  }',
    "  if (q.side === 'original' || q.side === 'adopted') {",
    '    const vars = data.variables[q.side][mode] ?? {};',
    "    const css = ':root:root:root{' + Object.entries(vars).map(([k, v]) => k + ':' + v).join(';') + '}';",
    '    return (',
    '      <>',
    '        <style dangerouslySetInnerHTML={{ __html: css }} />',
    "        <Frame side={q.side} component={q.component ?? ''} mode={mode} dark={mode === data.dark} />",
    '      </>',
    '    );',
    '  }',
    '  const widths = data.viewports.map((v) => v.width);',
    '  const width = widths.includes(Number(q.width)) ? Number(q.width) : widths[widths.length - 1];',
    "  const link = (p) => '?' + new URLSearchParams(p).toString();",
    '  return (',
    "    <main data-fwos-gallery-index=\"\" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>",
    "      <h1>{data.name}: original and adopted</h1>",
    "      <p>Each component renders twice: on the left with your source's own values, on the right with the design system fwos holds. fwos design-system report lists what differs, and why.</p>",
    "      <nav aria-label=\"Mode and width\" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>",
    "        {data.modes.map((m) => <a key={m} href={link({ mode: m, width: String(width) })} aria-current={m === mode ? 'page' : undefined}>{m}</a>)}",
    "        {data.viewports.map((v) => <a key={v.name} href={link({ mode, width: String(v.width) })} aria-current={v.width === width ? 'page' : undefined}>{v.name} ({v.width}px)</a>)}",
    '      </nav>',
    '      {data.components.map((c) => (',
    '        <section key={c.id} aria-label={c.id}>',
    '          <h2>{c.id} <small>({c.kind})</small></h2>',
    "          <div style={{ display: 'flex', gap: 16, overflowX: 'auto' }}>",
    "            {['original', 'adopted'].map((side) => (",
    '              <figure key={side} style={{ margin: 0 }}>',
    '                <figcaption>{side}</figcaption>',
    '                {c[side] ? (',
    "                  <iframe title={c.id + ' ' + side} src={link({ side, mode, component: c.id })} width={width} height={360} style={{ border: '1px solid currentColor' }} />",
    '                ) : (',
    '                  <p>Nothing renders on this side.</p>',
    '                )}',
    '              </figure>',
    '            ))}',
    '          </div>',
    '        </section>',
    '      ))}',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
}

/** The Playwright config: Chromium against `next dev` on its own port, or an app already running at FWOS_GALLERY_URL. */
function configFile(place: { app: string; folder: string }, command: string): string {
  const appDir = rel(place.folder, place.app);
  return [
    HEADER('Runs the comparison.'),
    '// @ts-nocheck',
    '/* eslint-disable */',
    '// Renders both sides of every component in Chromium and compares them, then writes',
    `// ${FIDELITY_RESULTS} and screenshots in ${GALLERY_SHOTS}/. From the project root:`,
    `//   ${command}`,
    '// It starts `next dev` on FWOS_GALLERY_PORT (default 3290), or uses the app at FWOS_GALLERY_URL.',
    'const port = Number(process.env.FWOS_GALLERY_PORT ?? 3290);',
    "const url = process.env.FWOS_GALLERY_URL ?? 'http://localhost:' + port;",
    '',
    'export default {',
    "  testDir: '.',",
    "  testMatch: 'gallery.pw.ts',",
    '  timeout: 30 * 60 * 1000,',
    "  reporter: 'list',",
    '  workers: 1,',
    "  use: { baseURL: url, browserName: 'chromium' },",
    '  webServer: process.env.FWOS_GALLERY_URL',
    '    ? undefined',
    '    : {',
    `        command: 'node node_modules/next/dist/bin/next dev --port ' + port,`,
    `        cwd: ${JSON.stringify(appDir)},`,
    `        url: url + ${JSON.stringify(GALLERY_ROUTE)},`,
    "        env: { FWOS_SCREENS: '1' },",
    '        reuseExistingServer: false,',
    '        timeout: 300 * 1000,',
    '      },',
    '};',
    '',
  ].join('\n');
}

/**
 * The runner, as it is written into the app. Plain JavaScript that needs nothing from fwos: it reads
 * gallery.json next to it, renders each side of each component in each mode at each width, and
 * compares computed styles at rest, hovered, focused and open, and what each interaction does. A
 * difference names the variables whose adopted value alone accounts for it.
 */
const RUNNER = String.raw`
const PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'opacity', 'box-shadow', 'outline-color', 'outline-style', 'outline-width', 'outline-offset', 'text-decoration-line', 'text-decoration-color', 'fill', 'stroke'];
const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
const OVERLAY = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]';

/**
 * Installed in each page: reads every element of a cell with its computed styles once animations
 * are settled, and swaps variables to the adopted side's values to find what a difference comes from.
 */
function helpers() {
  const still = () => {
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.getTiming();
      if (t && t.iterations === Infinity) a.cancel();
      else a.finish();
    }
  };
  const rootOf = (selector, last) => {
    const all = document.querySelectorAll(selector);
    return last ? all[all.length - 1] : all[0];
  };
  const read = (el, prop) => {
    if (prop === 'tag') return el.tagName.toLowerCase();
    if (prop === 'width' || prop === 'height') {
      const b = el.getBoundingClientRect();
      return String(Math.round((prop === 'width' ? b.width : b.height) * 2) / 2);
    }
    return getComputedStyle(el).getPropertyValue(prop);
  };
  const at = (root, last, path) => {
    const steps = path.split('.').map(Number);
    let el = last ? root : root.children[steps[0]];
    for (const s of steps.slice(1)) el = el ? el.children[s] : null;
    return el || null;
  };
  window.__fwos = {
    snapshot(selector, props, last) {
      still();
      const root = rootOf(selector, last);
      if (!root) return null;
      const out = {};
      const walk = (el, path) => {
        if (Object.keys(out).length >= 40) return;
        const styles = { tag: read(el, 'tag'), width: read(el, 'width'), height: read(el, 'height') };
        for (const p of props) styles[p] = read(el, p);
        out[path] = styles;
        let i = 0;
        for (const child of el.children) walk(child, path + '.' + i++);
      };
      if (last) walk(root, '0');
      else {
        let i = 0;
        for (const child of root.children) walk(child, String(i++));
      }
      return out;
    },
    attribute(selector, last, diffs, swaps) {
      const html = document.documentElement;
      const now = () => {
        still();
        const root = rootOf(selector, last);
        return diffs.map((d) => {
          const el = root ? at(root, last, d.path) : null;
          return el ? read(el, d.property) : null;
        });
      };
      const set = (name, value) => html.style.setProperty(name, value === '' ? 'initial' : value);
      const base = now();
      const causes = diffs.map(() => []);
      for (const [name, value] of swaps) {
        set(name, value);
        now().forEach((v, i) => {
          if (v !== base[i]) causes[i].push(name);
        });
        html.style.removeProperty(name);
      }
      // With every swap at once, a property that still differs has no cause among them.
      for (const [name, value] of swaps) set(name, value);
      const together = now();
      for (const [name] of swaps) html.style.removeProperty(name);
      return diffs.map((d, i) => (together[i] === d.adopted ? (causes[i].length > 0 ? causes[i] : swaps.map(([n]) => n)) : []));
    },
    variables(names) {
      const cs = getComputedStyle(document.documentElement);
      const out = {};
      for (const n of names) out[n] = cs.getPropertyValue(n).trim();
      return out;
    },
    focusInto(selector) {
      const r = document.querySelector(selector);
      r.tabIndex = -1;
      r.focus();
    },
    focusedInside(selector) {
      const r = document.querySelector(selector);
      return !!r && r !== document.activeElement && r.contains(document.activeElement);
    },
    blur() {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },
    presses() {
      return window.__fwosPresses || [];
    },
    clearPresses() {
      window.__fwosPresses = [];
    },
  };
}

const cellSelector = (id) => '[data-fwos-cell="' + id.replace(/"/g, '\\"') + '"] [data-fwos-render]';
const snap = (page, selector, last) => page.evaluate(([s, p, l]) => window.__fwos.snapshot(s, p, l), [selector, PROPS, last]);

function compare(prefix, o, a) {
  const out = [];
  for (const path of new Set([...Object.keys(o || {}), ...Object.keys(a || {})])) {
    const x = o && o[path];
    const y = a && a[path];
    if (!x || !y) {
      out.push({ path, element: prefix + path, property: 'tag', original: x ? x.tag : 'missing', adopted: y ? y.tag : 'missing' });
      continue;
    }
    for (const p of Object.keys(x)) if (x[p] !== y[p]) out.push({ path, element: prefix + path, property: p, original: x[p], adopted: y[p] });
  }
  return out;
}

async function open(page, side, mode, id) {
  await page.goto(ROUTE + '?side=' + side + '&mode=' + encodeURIComponent(mode) + '&component=' + encodeURIComponent(id));
  await page.locator('html[data-fwos-ready]').waitFor({ state: 'attached', timeout: 60000 });
  await page.locator('[data-fwos-gallery]').waitFor({ timeout: 60000 });
  await page.evaluate(helpers);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function target(page, sel) {
  const inside = page.locator(sel).locator(INTERACTIVE).first();
  if (await inside.count()) return inside;
  const first = page.locator(sel + ' > *').first();
  return (await first.count()) ? first : null;
}

async function leave(page) {
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__fwos.blur());
}

/** Puts the cell in a state: hovered, focused from the keyboard, or open. False when it can't. */
async function enter(page, sel, state) {
  const t = await target(page, sel);
  if (!t) return false;
  try {
    if (state === 'hover') await t.hover({ force: true, timeout: 3000 });
    if (state === 'focus') {
      await page.evaluate((s) => window.__fwos.focusInto(s), sel);
      await page.keyboard.press('Tab');
      return await page.evaluate((s) => window.__fwos.focusedInside(s), sel);
    }
    if (state === 'open') {
      await t.click({ timeout: 3000 });
      await page.locator(OVERLAY).last().waitFor({ state: 'visible', timeout: 3000 });
    }
    return true;
  } catch {
    return false;
  }
}

/** A screenshot of a cell with what it opened, so an open menu shows in the sheet too. */
async function shootOpen(page, sel, file) {
  const boxes = [await page.locator(sel).boundingBox(), await page.locator(OVERLAY).last().boundingBox()].filter(Boolean);
  if (!boxes.length) return null;
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 16);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 16);
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 16;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 16;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, clip: { x, y, width: right - x, height: bottom - y }, animations: 'disabled' });
  return file;
}

/** Each state a cell shows (at rest, hovered, focused, open) and what each interaction does to it. */
async function exercise(page, entryId, cell, shot) {
  const sel = cellSelector(cell.id);
  const states = { rest: { selector: sel, last: false, snap: await snap(page, sel, false) } };
  const behaviour = {};
  const has = (i) => cell.interactions.includes(i);
  const t = await target(page, sel);
  if (t && has('hover')) {
    if (await enter(page, sel, 'hover')) {
      states.hover = { selector: sel, last: false, snap: await snap(page, sel, false) };
      const changed = [...new Set(compare('', states.rest.snap, states.hover.snap).map((d) => d.property))].sort();
      behaviour.hover = changed.length ? 'changes ' + changed.join(', ') : 'no change';
    } else behaviour.hover = 'could not hover';
    await leave(page);
  }
  if (t && has('focus')) {
    if (await enter(page, sel, 'focus')) {
      behaviour.focus = 'reaches it';
      states.focus = { selector: sel, last: false, snap: await snap(page, sel, false) };
    } else behaviour.focus = 'skips it';
    await leave(page);
  }
  if (t && has('type')) {
    const field = page.locator(sel).locator('input, textarea').first();
    if (await field.count()) {
      try {
        await field.fill('abc', { timeout: 2000 });
        behaviour.type = (await field.inputValue()) === 'abc' ? 'takes text' : 'refuses text';
        await field.fill('', { timeout: 2000 });
      } catch {
        behaviour.type = 'refuses text';
      }
    }
  }
  if (t && has('press')) {
    if ((await t.evaluate((el) => el.tagName.toLowerCase())) === 'a') behaviour.press = 'a link, not followed';
    else {
      const url = page.url();
      await page.evaluate(() => window.__fwos.clearPresses());
      try {
        await t.click({ force: true, timeout: 2000 });
      } catch {}
      if (page.url() !== url) {
        behaviour.press = 'navigates away';
        await page.goto(url);
        await page.evaluate(helpers);
      } else {
        const fired = (await page.evaluate(() => window.__fwos.presses())).includes(entryId + '/' + cell.id);
        behaviour.press = fired ? 'fires' : 'does nothing';
      }
      await leave(page);
    }
  }
  if (t && has('open')) {
    if (await enter(page, sel, 'open')) {
      const overlay = page.locator(OVERLAY).last();
      behaviour.open = 'opens a ' + ((await overlay.getAttribute('role')) || 'panel');
      states.open = { selector: OVERLAY, last: true, snap: await snap(page, OVERLAY, true) };
      if (shot && cell.id === 'default') await shootOpen(page, sel, shot);
    } else behaviour.open = 'stays closed';
    await leave(page);
  }
  if (has('check')) {
    const items = page.locator(sel).locator('[role="radio"], [role="checkbox"], [role="switch"], input[type="checkbox"], input[type="radio"]');
    const n = await items.count();
    if (n) {
      const item = items.nth(n - 1);
      try {
        await item.click({ timeout: 2000 });
      } catch {}
      const on = await item.evaluate((el) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked' || el.checked === true);
      behaviour.check = on ? 'checks it' : 'stays unchecked';
    }
  }
  return { states, behaviour };
}

/** What differs between the two sides of a cell, each style difference traced to the variables behind it. */
async function differ(page, cell, o, a, swaps) {
  const out = [];
  for (const state of Object.keys(o.states)) {
    if (!a.states[state]) continue;
    const prefix = state === 'rest' ? '' : state + ':';
    const all = compare(prefix, o.states[state].snap, a.states[state].snap);
    const styles = all.filter((d) => d.property !== 'tag');
    for (const d of all.filter((x) => x.property === 'tag')) out.push({ ...d, causes: [] });
    if (!styles.length) continue;
    const sel = cellSelector(cell.id);
    const ok = state === 'rest' || (await enter(page, sel, state));
    const causes = ok
      ? await page.evaluate(([s, l, d, w]) => window.__fwos.attribute(s, l, d, w), [o.states[state].selector, o.states[state].last, styles, swaps])
      : styles.map(() => []);
    if (state !== 'rest') await leave(page);
    styles.forEach((d, i) => out.push({ ...d, causes: causes[i] }));
  }
  return out;
}

test('original and adopted components render and behave the same', async ({ browser }, info) => {
  const here = dirname(info.config.configFile);
  const data = JSON.parse(readFileSync(join(here, 'gallery.json'), 'utf8'));
  const names = [...new Set(Object.values(data.variables).flatMap((byMode) => Object.values(byMode).flatMap((v) => Object.keys(v))))];
  const out = { schema: 1, gallery: data.hash, browser: 'Chromium ' + browser.version(), cells: [], errors: [] };
  const shots = join(here, SHOTS);
  mkdirSync(shots, { recursive: true });
  for (const viewport of data.viewports) {
    for (const mode of data.modes) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: mode === data.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', (e) => out.errors.push(mode + ', ' + viewport.name + ': ' + e.message));
      const sheet = [];
      for (const e of data.components) for (const side of ['original', 'adopted']) rmSync(join(shots, e.id, mode + '-' + viewport.name + '-' + side + '-open.png'), { force: true });
      for (const entry of data.components) {
        const seen = {};
        for (const side of ['adopted', 'original']) {
          if (!entry[side]) continue;
          await open(page, side, mode, entry.id);
          const file = join(shots, entry.id, mode + '-' + viewport.name + '-' + side + '.png');
          mkdirSync(dirname(file), { recursive: true });
          await page.locator('[data-fwos-gallery]').screenshot({ path: file, animations: 'disabled' });
          sheet.push({ entry: entry.id, side, file });
          const vars = await page.evaluate((n) => window.__fwos.variables(n), names);
          const cells = {};
          const openShot = join(shots, entry.id, mode + '-' + viewport.name + '-' + side + '-open.png');
          for (const cell of entry[side].cells) cells[cell.id] = await exercise(page, entry.id, cell, openShot);
          if (existsSync(openShot)) sheet.push({ entry: entry.id, side: side + '-open', file: openShot });
          seen[side] = { vars, cells };
        }
        // The original page is the one open: trace its differences while it is.
        const swaps = seen.original && seen.adopted ? names.filter((n) => seen.original.vars[n] !== seen.adopted.vars[n]).map((n) => [n, seen.adopted.vars[n]]) : [];
        const ids = [...new Set([...((entry.original && entry.original.cells) || []), ...((entry.adopted && entry.adopted.cells) || [])].map((c) => c.id))];
        for (const id of ids) {
          const o = seen.original && seen.original.cells[id];
          const a = seen.adopted && seen.adopted.cells[id];
          const missing = !o ? 'original' : !a ? 'adopted' : undefined;
          const cell = entry.original ? entry.original.cells.find((c) => c.id === id) : null;
          const differences = o && a && cell ? (await differ(page, cell, o, a, swaps)).map((d) => ({ element: d.element, property: d.property, original: d.original, adopted: d.adopted, causes: d.causes })) : [];
          const behaviour = o && a ? [...new Set([...Object.keys(o.behaviour), ...Object.keys(a.behaviour)])].sort().map((k) => ({ interaction: k, original: o.behaviour[k] || 'not tried', adopted: a.behaviour[k] || 'not tried' })) : [];
          out.cells.push({ component: entry.id, cell: id, mode, viewport: viewport.name, differences, behaviour, ...(missing ? { missing } : {}) });
        }
      }
      // One sheet per mode and width: each component's original beside its adopted side.
      const img = (id, side) => {
        const s = sheet.find((x) => x.entry === id && x.side === side);
        return s ? '<img alt="" src="data:image/png;base64,' + readFileSync(s.file).toString('base64') + '">' : '<p>nothing renders on this side</p>';
      };
      const rows = data.components.map((e) => {
        const pair = (a, b, label) => '<div class="row"><figure><figcaption>original' + label + '</figcaption>' + img(e.id, a) + '</figure><figure><figcaption>adopted' + label + '</figcaption>' + img(e.id, b) + '</figure></div>';
        const opened = sheet.some((x) => x.entry === e.id && x.side.endsWith('-open'));
        return '<h2>' + e.id + ' <small>' + e.kind + '</small></h2>' + pair('original', 'adopted', '') + (opened ? pair('original-open', 'adopted-open', ', open') : '');
      });
      const sheetPage = await context.newPage();
      await sheetPage.setViewportSize({ width: Math.min(viewport.width, 800) * 2 + 96, height: 800 });
      await sheetPage.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:24px;font:14px system-ui,sans-serif;background:#fff;color:#111}.row{display:flex;gap:32px;align-items:flex-start}figure{margin:0;max-width:50%}figcaption{margin:0 0 8px;color:#555}img{display:block;max-width:100%;border:1px solid #ddd}h1{font-size:18px}h2{font-size:15px;margin:24px 0 8px}small{color:#777;font-weight:400}</style><h1>' + data.name + ': ' + mode + ', ' + viewport.name + ' (' + viewport.width + 'px)</h1>' + rows.join(''));
      await sheetPage.screenshot({ path: join(shots, mode + '-' + viewport.name + '.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
      await sheetPage.close();
      await context.close();
    }
  }
  const results = join(here, RESULTS);
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(results, JSON.stringify(out, null, 2) + '\n');
  expect(out.errors).toEqual([]);
});
`;

function specFile(folder: string): string {
  return [
    HEADER('The comparison runner.'),
    '// @ts-nocheck',
    '/* eslint-disable */',
    "import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    "import { expect, test } from '@playwright/test';",
    '',
    '// From this folder to the project root\'s results and screenshots.',
    `const RESULTS = '${rel(folder, FIDELITY_RESULTS)}';`,
    `const SHOTS = '${rel(folder, GALLERY_SHOTS)}';`,
    `const ROUTE = ${JSON.stringify(GALLERY_ROUTE)};`,
    RUNNER,
  ].join('\n');
}

/** The command, from the project root, that runs the comparison. */
export function galleryCommand(project: Project): string {
  const place = placeOf(project);
  const app = webApp(project);
  const folder = place ? place.folder : posix.join(app, 'app/(fwos-screens)/fwos-screens/fwos-gallery');
  const config = `${posix.relative(app, folder) || '.'}/playwright.config.ts`;
  return app === '.' ? `pnpm exec playwright test -c "${config}"` : `pnpm --dir ${app} exec playwright test -c "${config}"`;
}

/** What renders a model in the app, but its data: the page, the frame, the config and the runner. */
function renderers(project: Project, place: NonNullable<ReturnType<typeof placeOf>>, model: GalleryModel): [string, string][] {
  return [
    ['page.tsx', pageFile()],
    ['frame.tsx', frameFile(project, place.folder, model)],
    ['playwright.config.ts', configFile(place, galleryCommand(project))],
    ['gallery.pw.ts', specFile(place.folder)],
  ];
}

/** Conservative rendering inputs, including helpers, styles and compiler/dependency config.
 * The normal project walk excludes build output and the generated gallery itself. */
export function galleryInputs(project: Project): string[] {
  return [...new Set([...revisionInputs(project), ...project.files(['*.{json,js,cjs,mjs,ts,css,yaml,yml}', ...project.paths.source], ['.fwos/**', `${project.paths.docs}/**`, ...project.paths.results, '**/next-env.d.ts', '**/*.tsbuildinfo'])])]
    .filter((file) => !isTestFile(project, file) && (!/\.md$/i.test(file) || matchAny(file, project.paths.source))).sort();
}

function hashOf(project: Project, model: GalleryModel): string {
  const place = placeOf(project);
  const componentSources = model.components.flatMap((entry) => [entry.original?.file, entry.adopted?.file]).filter((file): file is string => !!file).flatMap((file) => isDir(project.abs(file)) ? project.files([`${file}/**`]) : [file]);
  const implementations = [...new Set([...galleryInputs(project), ...componentSources])].sort().map((file) => `${file}\0${hashFile(project.abs(file)) ?? 'missing'}`);
  const files = place ? renderers(project, place, model).map(([name, text]) => `${name}\0${text}`) : [];
  return hashText([galleryHash(model), ...implementations, ...files].join('\n'));
}

export const gallery: GalleryAdapter = {
  platform: 'web',
  describe: describeComponent,
  files(project, model) {
    const place = placeOf(project);
    if (!place) {
      const app = webApp(project);
      const where = app === '.' ? 'app/ or src/app/' : `${app}/app/ or ${app}/src/app/`;
      return { reason: `no ${where} folder: scaffold the app first (\`fwos scaffold web\`)` };
    }
    const source = 'design-system/';
    const at = (name: string) => posix.join(place.folder, name);
    const files: GeneratedFile[] = [
      { path: at('gallery.json'), content: `${JSON.stringify({ ...model, hash: hashOf(project, model) }, null, 2)}\n`, source },
      ...renderers(project, place, model).map(([name, content]) => ({ path: at(name), content, source })),
    ];
    return { files, folder: place.folder };
  },
  command: galleryCommand,
  hash: hashOf,
};
