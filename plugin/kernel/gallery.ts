// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The comparison gallery's contract. The design-system module describes what to compare (each
// component's original and adopted side, and the variables each side sets); a platform reads its
// components' source, renders the gallery in the real app and drives a browser over it, which
// writes the results file this module also describes.

import type { GeneratedFile } from './adapters.ts';
import type { Platform } from './check.ts';
import { hashText } from './hash.ts';
import type { Project } from './project.ts';

/** Where a gallery run writes its results, relative to the project root. Local evidence, like JUnit files. */
export const FIDELITY_RESULTS = '.fwos/local/results/fidelity.json';

/** Where a gallery run writes its screenshots, relative to the project root. */
export const GALLERY_SHOTS = '.fwos/local/gallery';

export type GalleryInteraction = 'hover' | 'focus' | 'press' | 'type' | 'open' | 'check';

/** One rendering of a component in the gallery: the default, one variant value or one state. */
export interface GalleryCell {
  /** `default`, `variant=destructive` or `state=disabled`. */
  id: string;
  /** What the recipe passes: variant values and the props that set a state. */
  props: Record<string, string | boolean>;
  /** The states it shows, by the names the registry and the source use. */
  states: string[];
  /** What the browser does to it on each side, so behaviour is compared as well as looks. */
  interactions: GalleryInteraction[];
}

/** One fact about a component and the file text it was read from: `variant` from `cva(...)`. */
export interface SourcedName {
  name: string;
  from: string;
}

/** What a component's own source says about it, read without running it. */
export interface ComponentFacts {
  id: string;
  /** Its file, or its folder for a component that is one. */
  file: string;
  /** Every name the file exports. */
  exports: string[];
  /** The one it exports as the default, which is imported as the default. */
  defaultExport?: string;
  /** The exports that are components (PascalCase), the one named after the id first. */
  components: string[];
  /** Variant axes, each with its values, the default first. */
  variants: { name: string; values: string[]; default: string; from: string }[];
  /** States it can render: from its props, its class variants and the registry. */
  states: SourcedName[];
  /** What a person can do with it. */
  interactions: SourcedName[];
  /** The gallery recipe that renders it: `fwos:button`, `shadcn:card`, or `generic` when none fits. */
  recipe: string;
  /** What the gallery renders: the default, each variant value and each state it can set. */
  cells: GalleryCell[];
  /** States it declares that the gallery has no way to set, so nothing renders them. */
  unrendered: string[];
}

/**
 * How a component appears in the gallery. reused: yours, on both sides. starter: fwos's own, on
 * both sides. replaced: yours on the original side and what replaces it on the adopted side.
 * omitted: yours, on the original side only.
 */
export type GalleryKind = 'reused' | 'starter' | 'replaced' | 'omitted';

export interface GalleryEntry {
  id: string;
  kind: GalleryKind;
  original: ComponentFacts | null;
  adopted: ComponentFacts | null;
}

export type GallerySide = 'original' | 'adopted';

export interface GalleryModel {
  schema: 1;
  name: string;
  modes: string[];
  /** The mode a frame renders dark (the `dark` class and `data-theme`), or null. */
  dark: string | null;
  viewports: { name: string; width: number; height: number }[];
  /**
   * The CSS custom properties each side sets on the page, per mode. Original: the source's own
   * values. Adopted: the design system fwos holds. `initial` removes a value the source had.
   */
  variables: Record<GallerySide, Record<string, Record<string, string>>>;
  /** Which mapping row each variable comes from, so a difference names its cause. */
  rows: Record<string, string>;
  components: GalleryEntry[];
}

/** The hash of a gallery model: the same model, the same hash, on any machine. A platform adds its files to it. */
export function galleryHash(model: GalleryModel): string {
  return hashText(JSON.stringify(model));
}

/** Where the gallery lives inside an app's route folder: dev-only, under the screens browser. */
export const GALLERY_ROUTE = '/fwos-screens/fwos-gallery';

/** Renders a gallery in the platform's real app and runs the comparison in a browser. */
export interface GalleryAdapter {
  platform: Platform;
  /** What a component's source says about it. `declared` is the registry's required states. */
  describe(project: Project, item: { id: string; file: string; source?: string }, declared: string[]): ComponentFacts;
  /** The app files that render `model` and the runner that compares its sides. Null with the reason when the app can't host it. */
  files(project: Project, model: GalleryModel): { files: GeneratedFile[]; folder: string } | { reason: string };
  /** The command, from the project root, that runs the comparison and writes the results. */
  command(project: Project): string;
  /**
   * The hash a run of this gallery records: of the model and of every file that renders it, so a
   * run made before either changed is out of date.
   */
  hash(project: Project, model: GalleryModel): string;
}

/** One computed-style difference between the sides of a cell. */
export interface FidelityDifference {
  /** Which element in the cell (`0` is the root, `1.2` a descendant), with `hover:` or `focus:` for those states. */
  element: string;
  property: string;
  original: string;
  adopted: string;
  /** The variables whose adopted value alone accounts for it: empty when none does. */
  causes: string[];
}

export interface FidelityCell {
  component: string;
  cell: string;
  mode: string;
  viewport: string;
  differences: FidelityDifference[];
  /** Each interaction's outcome on each side. */
  behaviour: { interaction: string; original: string; adopted: string }[];
  /** A side that didn't render this cell. */
  missing?: GallerySide;
}

/** What a gallery run writes to FIDELITY_RESULTS. */
export interface FidelityResults {
  schema: 1;
  /** The hash of the gallery it rendered (GalleryAdapter.hash). Any other hash means the run is out of date. */
  gallery: string;
  browser: string;
  cells: FidelityCell[];
  /** Errors the pages threw while it ran. */
  errors: string[];
}
