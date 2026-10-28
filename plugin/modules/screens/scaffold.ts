// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The walking skeleton: copies the platform template into the user's project. Every file it
// writes becomes theirs (recorded in .fwos/provenance.json) and is never overwritten.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FwosError, isDir, pluginPath, readText } from '../../kernel/index.ts';

export const TEMPLATES_DIR = pluginPath('modules', 'screens', 'templates');

export interface ScaffoldVars {
  APP_NAME: string;
  APP_SLUG: string;
}

export interface TemplateFile {
  path: string;
  content: string;
}

/** Template files for a platform with `{{VAR}}` placeholders filled. `_gitignore` becomes `.gitignore`. */
export function renderTemplate(platform: string, vars: ScaffoldVars): TemplateFile[] {
  const dir = join(TEMPLATES_DIR, platform);
  if (!isDir(dir)) throw new FwosError(`No scaffold template for ${platform} in this version of fwos.`);
  const out: TemplateFile[] = [];
  const walk = (abs: string, rel: string) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(abs, e.name), r);
      else {
        const text = readText(join(abs, e.name)) ?? '';
        const path = r.replace(/(^|\/)_gitignore$/, '$1.gitignore').replace(/(^|\/)_npmrc$/, '$1.npmrc');
        const substitute = (value: string) => value.replace(/\{\{(APP_NAME|APP_SLUG)\}\}/g, (_, key: keyof ScaffoldVars) => vars[key]);
        const content = text.replace(/"(?:\\.|[^"\\])*"|\{\{(APP_NAME|APP_SLUG)\}\}/g, (literal, key: keyof ScaffoldVars) => {
          if (key) return vars[key].replace(/[\r\n]/g, ' ');
          return literal.includes('{{') ? JSON.stringify(substitute(JSON.parse(literal))) : literal;
        });
        out.push({ path, content });
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
