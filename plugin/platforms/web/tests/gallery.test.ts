// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
// Copyright (c) 2023 shadcn; adapted component fixtures (see NOTICE).

// The web gallery: what a component's source says it can render (variants, states, interactions),
// and the dev-only route and Playwright runner that render both sides in the real app.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type GalleryModel, galleryHash, loadProject, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { gallery } from '../index.ts';

afterAll(cleanupTempProjects);

const UI = new URL('../../../modules/screens/templates/web/apps/web/src/shared/ui/', import.meta.url).pathname;
const starter = (name: string) => readFileSync(join(UI, `${name}.tsx`), 'utf8');

/** A shadcn-style button: cva variants, native button props, state classes. Written for this test. */
const SHADCN_BUTTON = `import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex rounded-md disabled:opacity-50 focus-visible:ring-ring/50 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white",
        outline: "border bg-background hover:bg-accent",
        "ghost-muted": "hover:bg-muted",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
`;

const SHADCN_INPUT = `import * as React from "react";
import { cn } from "@/lib/utils";
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn("border-input disabled:opacity-50 focus-visible:ring-ring aria-invalid:border-destructive", className)} {...props} />;
}
export { Input };
`;

const SHADCN_CARD = `import * as React from "react";
function Card(props: React.ComponentProps<"div">) { return <div data-slot="card" className="bg-card text-card-foreground" {...props} />; }
function CardHeader(props: React.ComponentProps<"div">) { return <div data-slot="card-header" {...props} />; }
function CardTitle(props: React.ComponentProps<"div">) { return <div data-slot="card-title" {...props} />; }
function CardContent(props: React.ComponentProps<"div">) { return <div data-slot="card-content" {...props} />; }
export { Card, CardHeader, CardTitle, CardContent };
`;

const SHADCN_MENU = `"use client";
import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) { return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />; }
function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) { return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />; }
function DropdownMenuContent(props: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content data-slot="dropdown-menu-content" className="bg-popover data-[state=open]:animate-in" {...props} /></DropdownMenuPrimitive.Portal>;
}
function DropdownMenuItem(props: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) { return <DropdownMenuPrimitive.Item data-slot="dropdown-menu-item" className="focus:bg-accent" {...props} />; }
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
`;

const SHADCN_RADIO = `"use client";
import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "@radix-ui/react-radio-group";
function RadioGroup(props: React.ComponentProps<typeof RadioGroupPrimitive.Root>) { return <RadioGroupPrimitive.Root data-slot="radio-group" {...props} />; }
function RadioGroupItem(props: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return <RadioGroupPrimitive.Item data-slot="radio-group-item" className="border-input focus-visible:ring-ring disabled:opacity-50" {...props} />;
}
export { RadioGroup, RadioGroupItem };
`;

/** An adopted app with shadcn components in components/ui, as fwos adopt records it. */
function adopted(files: Record<string, string>) {
  return loadProject(
    tempProject({
      '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'], paths: { apps: { web: '.' }, source: ['app/**', 'components/**', 'lib/**'], ui: { web: 'components/ui' } } },
      'package.json': { dependencies: { next: '15.3.0', react: '19.1.0' } },
      'app/layout.tsx': 'export default function L({ children }) { return children; }\n',
      'app/page.tsx': 'export default function P() { return null; }\n',
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`components/ui/${k}.tsx`, v])),
    }),
  );
}

/** The scaffold's layout: the starter components in apps/web/src/shared/ui behind a barrel. */
function scaffolded(names: string[]) {
  return loadProject(
    tempProject({
      '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] },
      'apps/web/package.json': { dependencies: { next: '16.4.0', react: '19.3.0' } },
      'apps/web/app/layout.tsx': 'export default function L({ children }) { return children; }\n',
      ...Object.fromEntries(names.map((n) => [`apps/web/src/shared/ui/${n}.tsx`, starter(n)])),
      'apps/web/src/shared/ui/index.ts': readFileSync(join(UI, 'index.ts'), 'utf8'),
    }),
  );
}

const describeIn = (p: ReturnType<typeof adopted>, id: string, file: string, declared: string[] = [], source?: string) =>
  gallery.describe(p, { id, file, ...(source ? { source } : {}) }, declared);

describe("reading fwos's starter components", () => {
  const p = scaffolded(['button', 'spinner', 'text-field', 'alert', 'empty-state', 'state-handler']);

  it('reads the button: its variants from the prop type, its states from props, classes and the registry', () => {
    const f = describeIn(p, 'button', 'apps/web/src/shared/ui/button.tsx', ['default', 'loading', 'disabled'], 'fwos');
    expect(f.components).toEqual(['Button']);
    expect(f.variants).toEqual([{ name: 'variant', values: ['primary', 'secondary', 'ghost', 'danger'], default: 'primary', from: 'type ButtonVariant' }]);
    expect(f.states).toEqual([
      { name: 'default', from: 'components.json' },
      { name: 'loading', from: 'prop loading' },
      { name: 'disabled', from: 'prop disabled' },
    ]);
    expect(f.interactions.map((i) => i.name)).toEqual(['press', 'hover', 'focus']);
    expect(f.recipe).toBe('fwos:button');
    expect(f.cells.map((c) => [c.id, c.props, c.states])).toEqual([
      ['default', { variant: 'primary' }, ['default']],
      ['variant=secondary', { variant: 'secondary' }, []],
      ['variant=ghost', { variant: 'ghost' }, []],
      ['variant=danger', { variant: 'danger' }, []],
      ['state=loading', { variant: 'primary', loading: true }, ['loading']],
      ['state=disabled', { variant: 'primary', disabled: true }, ['disabled']],
    ]);
    expect(f.unrendered).toEqual([]);
  });

  it('sets an invalid text field through its error prop', () => {
    const f = describeIn(p, 'text-field', 'apps/web/src/shared/ui/text-field.tsx', ['default', 'invalid', 'disabled'], 'fwos');
    expect(f.cells.map((c) => [c.id, c.props])).toEqual([
      ['default', {}],
      ['state=invalid', { error: 'Check this value' }],
      ['state=disabled', { disabled: true }],
    ]);
    expect(f.interactions.map((i) => i.name)).toEqual(['type', 'focus']);
  });

  it('renders a state that is a variant value, such as a critical alert, as that variant', () => {
    const f = describeIn(p, 'alert', 'apps/web/src/shared/ui/alert.tsx', ['critical', 'info'], 'fwos');
    expect(f.variants[0]).toMatchObject({ name: 'tone', values: ['info', 'critical', 'warning', 'caution', 'success'], default: 'info' });
    expect(f.cells.find((c) => c.id === 'tone=critical')!.states).toEqual(['critical']);
    expect(f.cells.find((c) => c.id === 'default')!.states).toEqual(['info']);
    expect(f.unrendered).toEqual([]);
  });

  it('reads a required union prop as an axis, and every value as a cell', () => {
    const f = describeIn(p, 'state-handler', 'apps/web/src/shared/ui/state-handler.tsx', ['loading', 'empty', 'error', 'ready'], 'fwos');
    expect(f.variants).toEqual([{ name: 'status', values: ['loading', 'error', 'empty', 'ready'], default: 'loading', from: 'type LoadStatus' }]);
    expect(f.cells.map((c) => c.id)).toEqual(['default', 'status=error', 'status=empty', 'status=ready']);
  });
});

describe('reading shadcn components', () => {
  const p = adopted({ button: SHADCN_BUTTON, input: SHADCN_INPUT, card: SHADCN_CARD, 'dropdown-menu': SHADCN_MENU, 'radio-group': SHADCN_RADIO, calendar: 'export function Calendar() { return null; }\n' });

  it('reads cva variants, the native props and the state classes', () => {
    const f = describeIn(p, 'button', 'components/ui/button.tsx');
    expect(f.exports).toEqual(['Button', 'buttonVariants']);
    expect(f.components).toEqual(['Button']);
    expect(f.variants).toEqual([
      { name: 'variant', values: ['default', 'destructive', 'outline', 'ghost-muted'], default: 'default', from: 'cva variants' },
      { name: 'size', values: ['default', 'sm', 'icon'], default: 'default', from: 'cva variants' },
    ]);
    expect(f.states).toEqual([
      { name: 'disabled', from: 'class disabled:' },
      { name: 'invalid', from: 'class aria-invalid:' },
    ]);
    expect(f.interactions.map((i) => i.name)).toEqual(['press', 'hover', 'focus']);
    expect(f.recipe).toBe('shadcn:button');
    expect(f.cells.map((c) => c.id)).toEqual(['default', 'variant=destructive', 'variant=outline', 'variant=ghost-muted', 'size=sm', 'size=icon', 'state=disabled', 'state=invalid']);
    expect(f.cells.find((c) => c.id === 'state=invalid')!.props).toEqual({ variant: 'default', size: 'default', 'aria-invalid': true });
  });

  it('reads an input as something you type in', () => {
    const f = describeIn(p, 'input', 'components/ui/input.tsx');
    expect(f.recipe).toBe('shadcn:input');
    expect(f.interactions.map((i) => i.name)).toEqual(['type', 'focus']);
    expect(f.cells.map((c) => c.id)).toEqual(['default', 'state=disabled', 'state=invalid']);
  });

  it('renders a compound component with its parts', () => {
    const f = describeIn(p, 'card', 'components/ui/card.tsx');
    expect(f.components).toEqual(['Card', 'CardHeader', 'CardTitle', 'CardContent']);
    expect(f.recipe).toBe('shadcn:card');
  });

  it('opens a menu and checks a radio, through Radix', () => {
    const menu = describeIn(p, 'dropdown-menu', 'components/ui/dropdown-menu.tsx');
    expect(menu.recipe).toBe('shadcn:dropdown-menu');
    expect(menu.interactions).toEqual([
      { name: 'open', from: 'radix-ui DropdownMenu' },
      { name: 'focus', from: 'class focus:' },
    ]);
    // The open state is what the open interaction shows, so it gets no cell of its own.
    expect(menu.states).toEqual([{ name: 'open', from: 'class data-[state=open]:' }]);
    expect(menu.cells.map((c) => [c.id, c.interactions])).toEqual([['default', ['open', 'focus']]]);
    expect(menu.unrendered).toEqual([]);
    const radio = describeIn(p, 'radio-group', 'components/ui/radio-group.tsx');
    expect(radio.recipe).toBe('shadcn:radio-group');
    expect(radio.interactions.map((i) => i.name)).toEqual(['check', 'focus']);
  });

  it('renders a component with no recipe generically, and lists the declared states it cannot set', () => {
    const f = describeIn(p, 'calendar', 'components/ui/calendar.tsx', ['selected', 'range']);
    expect(f.recipe).toBe('generic');
    expect(f.cells.map((c) => c.id)).toEqual(['default']);
    expect(f.unrendered).toEqual(['selected', 'range']);
  });
});

describe('the gallery files', () => {
  const model = (p: ReturnType<typeof adopted>, id: string, file: string, recipeSource?: string): GalleryModel => {
    const f = gallery.describe(p, { id, file, ...(recipeSource ? { source: recipeSource } : {}) }, []);
    return {
      schema: 1,
      name: 'Acme',
      modes: ['light', 'dark'],
      dark: 'dark',
      viewports: [{ name: 'phone', width: 390, height: 844 }],
      variables: { original: { light: { '--primary': 'oklch(0.2 0 0)' }, dark: { '--primary': 'oklch(0.9 0 0)' } }, adopted: { light: { '--primary': 'var(--ds-brand-primary)' }, dark: { '--primary': 'var(--ds-brand-primary)' } } },
      rows: { '--primary': 'brand.primary' },
      components: [{ id, kind: 'reused', original: f, adopted: f }],
    };
  };

  it("puts a dev-only route and its runner in an adopted app's app/ folder, importing your component from its file", () => {
    const p = adopted({ button: SHADCN_BUTTON });
    const m = model(p, 'button', 'components/ui/button.tsx');
    const out = gallery.files(p, m);
    if (!('files' in out)) throw new Error(out.reason);
    expect(out.folder).toBe('app/(fwos-screens)/fwos-screens/fwos-gallery');
    expect(out.files.map((f) => f.path).sort()).toEqual(['gallery.json', 'gallery.pw.ts', 'frame.tsx', 'page.tsx', 'playwright.config.ts'].map((f) => `${out.folder}/${f}`).sort());
    const frame = out.files.find((f) => f.path.endsWith('frame.tsx'))!.content;
    expect(frame).toMatch(/^\/\* generated by fwos, do not edit\./);
    expect(frame).toContain("'use client';");
    expect(frame).toContain("import { Button as Button_button } from '../../../../components/ui/button';");
    expect(frame).toContain('<Button_button variant="destructive" size="default"');
    const data = JSON.parse(out.files.find((f) => f.path.endsWith('gallery.json'))!.content);
    // The hash a run records covers the model and every file that renders it.
    expect(data.hash).toBe(gallery.hash(p, m));
    expect(data.hash).not.toBe(galleryHash(m));
    expect(out.files.every((f) => f.source === 'design-system/')).toBe(true);
    // Every check skips the gallery once it is written: it is fwos's tooling, not your code.
    for (const f of out.files) writeText(p.abs(f.path), f.content);
    const after = loadProject(p.root);
    expect(after.files(['**']).filter((f) => f.includes('fwos-gallery'))).toEqual([]);
    expect(after.files(['**'])).toContain('components/ui/button.tsx');
  });

  it('imports through the barrel when the UI folder has one, as the walls want', () => {
    const p = scaffolded(['button', 'spinner']);
    const out = gallery.files(p, model(p, 'button', 'apps/web/src/shared/ui/button.tsx', 'fwos'));
    if (!('files' in out)) throw new Error(out.reason);
    expect(out.folder).toBe('apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery');
    expect(out.files.find((f) => f.path.endsWith('frame.tsx'))!.content).toContain("import { Button as Button_button } from '../../../../src/shared/ui';");
  });

  it('runs the comparison with Playwright against next dev, and says so', () => {
    const p = adopted({ button: SHADCN_BUTTON });
    const out = gallery.files(p, model(p, 'button', 'components/ui/button.tsx'));
    if (!('files' in out)) throw new Error(out.reason);
    const config = out.files.find((f) => f.path.endsWith('playwright.config.ts'))!.content;
    expect(config).toContain("testMatch: 'gallery.pw.ts'");
    expect(config).toMatch(/next\/dist\/bin\/next dev/);
    expect(config).toContain("FWOS_SCREENS: '1'");
    const spec = out.files.find((f) => f.path.endsWith('gallery.pw.ts'))!.content;
    expect(spec).toContain("'../../../../.fwos/local/results/fidelity.json'");
    expect(gallery.command(p)).toBe('pnpm exec playwright test -c "app/(fwos-screens)/fwos-screens/fwos-gallery/playwright.config.ts"');
  });

  it('gives a run a hash that changes with the files that render it, not only with the model', () => {
    const p = adopted({ button: SHADCN_BUTTON });
    const m = model(p, 'button', 'components/ui/button.tsx');
    const before = gallery.hash(p, m);
    // A barrel changes how the frame imports the button, and nothing in the model.
    writeText(p.abs('components/ui/index.ts'), "export { Button } from './button';\n");
    const after = loadProject(p.root);
    expect(model(after, 'button', 'components/ui/button.tsx')).toEqual(m);
    expect(gallery.hash(after, m)).not.toBe(before);
  });

  it('imports a component exported as the default as the default', () => {
    const p = adopted({ banner: 'export default function Banner({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }\n' });
    const out = gallery.files(p, model(p, 'banner', 'components/ui/banner.tsx'));
    if (!('files' in out)) throw new Error(out.reason);
    const frame = out.files.find((f) => f.path.endsWith('frame.tsx'))!.content;
    expect(frame).toContain("import Banner_banner from '../../../../components/ui/banner';");
    expect(frame).toContain('<Banner_banner>Example</Banner_banner>');
  });

  // One fixture format: a component's state renders from the app's own fixture wherever fwos renders it.
  it("renders a state cell from the app's own state fixture when it has one, in the container fwos's state harness reads", () => {
    const p = scaffolded(['button', 'spinner']);
    writeText(p.abs('apps/web/src/screens/components.tsx'), "'use client';\n\nexport const componentStates = { button: { loading: () => null } };\n");
    // The screens barrel re-exports them with the registry: the frame imports the fixtures' own file all the same.
    writeText(p.abs('apps/web/src/screens/index.ts'), "export { componentStates } from './components';\nexport { screens } from './registry';\n");
    const after = loadProject(p.root);
    const f = gallery.describe(after, { id: 'button', file: 'apps/web/src/shared/ui/button.tsx', source: 'fwos' }, ['default', 'loading']);
    const out = gallery.files(after, { ...model(after, 'button', 'apps/web/src/shared/ui/button.tsx', 'fwos'), components: [{ id: 'button', kind: 'starter', original: f, adopted: f }] });
    if (!('files' in out)) throw new Error(out.reason);
    const frame = out.files.find((x) => x.path.endsWith('frame.tsx'))!.content;
    expect(frame).toContain("import { componentStates as FIXTURES } from '../../../../src/screens/components';");
    // A state cell asks for the app's fixture first, on both sides; the default cell stays the recipe, which counts a press.
    expect(frame.match(/"state=loading": \(\) => own\("button", "loading"\) \?\? \(<Button_button[^\n]* loading=\{true\}/g)).toHaveLength(2);
    expect(frame).toMatch(/"default": \(\) => <Button_button[^\n]*onClick=\{pressed\("button\/default"\)\}/);
    expect(frame).toContain('"state=loading": ["loading"]');
    expect(frame).toContain('data-fwos-fixture={`component:${component}`}');
    // The page renders one state of one component alone, for the harness and doctor: /fwos-screens/fwos-gallery?fixture=<id>&state=<state>.
    expect(out.files.find((x) => x.path.endsWith('page.tsx'))!.content).toContain('if (q.fixture) {');
  });

  it("renders recipes only where the app has no fixtures of its own, or the sides render different components", () => {
    const p = adopted({ button: SHADCN_BUTTON });
    const out = gallery.files(p, model(p, 'button', 'components/ui/button.tsx'));
    if (!('files' in out)) throw new Error(out.reason);
    const frame = out.files.find((x) => x.path.endsWith('frame.tsx'))!.content;
    expect(frame).not.toContain('FIXTURES');
    expect(frame).not.toContain('own(');
    expect(frame).toContain('"state=disabled": ["disabled"]');
    const withFixtures = scaffolded(['button']);
    writeText(withFixtures.abs('apps/web/src/screens/components.tsx'), "export const componentStates = {};\n");
    const q = loadProject(withFixtures.root);
    const mine = gallery.describe(q, { id: 'button', file: 'apps/web/src/shared/ui/button.tsx', source: 'fwos' }, ['loading']);
    const replaced = gallery.files(q, { ...model(q, 'button', 'apps/web/src/shared/ui/button.tsx', 'fwos'), components: [{ id: 'button', kind: 'replaced', original: mine, adopted: mine }] });
    if (!('files' in replaced)) throw new Error(replaced.reason);
    expect(replaced.files.find((x) => x.path.endsWith('frame.tsx'))!.content).not.toContain('own(');
  });

  it('says why when the app has no app/ folder to host it', () => {
    const p = loadProject(tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] } }));
    const out = gallery.files(p, { schema: 1, name: 'x', modes: ['light'], dark: null, viewports: [], variables: { original: {}, adopted: {} }, rows: {}, components: [] });
    expect(out).toEqual({ reason: 'no apps/web/app/ or apps/web/src/app/ folder: scaffold the app first (`fwos scaffold web`)' });
  });
});

// The limits the README states for the gallery, each pinned here.
describe('limits the README states', () => {
  it('renders a state from the prop that sets it, so in an app with no fixtures of its own a state only its markup can set has none', () => {
    const p = adopted({ button: SHADCN_BUTTON });
    // Positive control: a declared state a prop sets is a cell, a state fixture the harness can render.
    const f = gallery.describe(p, { id: 'button', file: 'components/ui/button.tsx' }, ['disabled', 'saving']);
    expect(f.cells.find((c) => c.states.includes('disabled'))?.id).toBe('state=disabled');
    // The miss: no prop sets "saving", so no cell shows it, and the gallery's fixture of it is missing.
    expect(f.cells.some((c) => c.states.includes('saving'))).toBe(false);
    expect(f.unrendered).toEqual(['saving']);
  });

  it('misses a variant built at runtime: it reads the source, not the running component', () => {
    const p = adopted({
      chip: `const tones = Object.fromEntries(['neutral', 'loud'].map((t) => [t, 'tone-' + t]));
export function Chip({ tone = 'neutral' }: { tone?: keyof typeof tones }) { return <span className={tones[tone]}>x</span>; }
`,
    });
    const f = gallery.describe(p, { id: 'chip', file: 'components/ui/chip.tsx' }, []);
    expect(f.variants).toEqual([]);
    expect(f.cells.map((c) => c.id)).toEqual(['default']);
  });

  it('renders a component it has no recipe for as its main export with a line of text', () => {
    const p = adopted({ chip: 'export function Chip({ children }: { children: React.ReactNode }) { return <span>{children}</span>; }\n' });
    const f = gallery.describe(p, { id: 'chip', file: 'components/ui/chip.tsx' }, []);
    const m: GalleryModel = { schema: 1, name: 'x', modes: ['light'], dark: null, viewports: [], variables: { original: {}, adopted: {} }, rows: {}, components: [{ id: 'chip', kind: 'reused', original: f, adopted: f }] };
    const out = gallery.files(p, m);
    if (!('files' in out)) throw new Error(out.reason);
    expect(out.files.find((x) => x.path.endsWith('frame.tsx'))!.content).toContain('"default": () => <Chip_chip>Example</Chip_chip>,');
  });
});


it('invalidates gallery evidence after an implementation-only component edit', () => {
  const project = adopted({ button: 'export function Button() { return <button>Before</button>; }' });
  const facts = gallery.describe(project, { id: 'button', file: 'components/ui/button.tsx' }, []);
  const model: GalleryModel = { schema: 1, name: 'fixture', modes: ['light'], dark: null, viewports: [{ name: 'phone', width: 390, height: 844 }], variables: { original: {}, adopted: {} }, rows: {}, components: [{ id: 'button', kind: 'reused', original: facts, adopted: facts }] };
  const before = gallery.hash(project, model);
  writeText(project.abs('components/ui/button.tsx'), 'export function Button() { return <button>After</button>; }');
  expect(gallery.hash(loadProject(project.root), model)).not.toBe(before);
});

it.each(['app/globals.css', 'lib/classes.ts', 'next.config.ts', 'pnpm-lock.yaml'])('invalidates a gallery after rendering dependency %s changes', (file) => {
  const project = adopted({ button: 'export function Button(){return <button>Button</button>;}' });
  writeText(project.abs(file), file.endsWith('.css') ? '.bg-brand { background: blue; }' : 'before');
  const model: GalleryModel = { schema: 1, name: 'fixture', modes: ['light'], dark: null, viewports: [{ name: 'phone', width: 390, height: 844 }], variables: { original: {}, adopted: {} }, rows: {}, components: [] };
  const before = gallery.hash(loadProject(project.root), model);
  writeText(project.abs(file), file.endsWith('.css') ? '.bg-brand { background: red !important; }' : 'after');
  expect(gallery.hash(loadProject(project.root), model)).not.toBe(before);
});
it('keeps repeated gallery generation stable without hashing its own generated files', () => {
  const project = adopted({ button: 'export function Button(){return <button>Button</button>;}' });
  const model: GalleryModel = { schema: 1, name: 'fixture', modes: ['light'], dark: null, viewports: [{ name: 'phone', width: 390, height: 844 }], variables: { original: {}, adopted: {} }, rows: {}, components: [] };
  const before = gallery.hash(project, model);
  for (let repeat = 0; repeat < 2; repeat++) {
    const output = gallery.files(loadProject(project.root), model);
    if (!('files' in output)) throw new Error(output.reason);
    for (const file of output.files) writeText(project.abs(file.path), file.content);
    expect(gallery.hash(loadProject(project.root), model)).toBe(before);
  }
});
