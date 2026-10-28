// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Static response evidence only. Never imports or executes a project's configuration.
import { parse } from '@babel/parser';

type Node = { type: string; [key: string]: any };
export type CspEvidence = 'present' | 'absent' | 'unknown';
const UNKNOWN = Symbol('unresolved source expression');
const DIRECTIVES = /^(?:default-src|script-src(?:-elem|-attr)?|style-src(?:-elem|-attr)?|img-src|connect-src|font-src|media-src|object-src|frame-src|child-src|worker-src|manifest-src|base-uri|form-action|frame-ancestors|sandbox|upgrade-insecure-requests|block-all-mixed-content|require-trusted-types-for|trusted-types|report-uri|report-to)$/i;
const policy = (value: unknown): CspEvidence => Array.isArray(value) ? value.every((v) => policy(v) === 'present') ? 'present' : value.some((v) => policy(v) === 'absent') ? 'absent' : 'unknown' : value === UNKNOWN ? 'unknown' : typeof value === 'string' && value.trim() !== '' && !/[\r\n\0]/.test(value) && value.split(';').some((part) => part.trim()) && value.split(';').filter((part) => part.trim()).every((part) => DIRECTIVES.test(part.trim().split(/\s+/)[0]!)) ? 'present' : 'absent';
const name = (n: Node | undefined): string | undefined => n?.type === 'Identifier' ? n.name : n?.type === 'StringLiteral' ? n.value : undefined;
const unwrap = (n: Node): Node => ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(n?.type) ? unwrap(n.expression) : n;
const property = (n: Node | undefined, key: string): Node | undefined => n?.type === 'ObjectExpression' ? n.properties.find((p: Node) => !p.computed && name(p.key) === key) : undefined;
const valueOf = (p: Node | undefined): Node | undefined => p?.type === 'ObjectMethod' ? p : p?.value;
const combine = (states: CspEvidence[]): CspEvidence => states.includes('present') ? 'present' : states.includes('unknown') ? 'unknown' : 'absent';

function parsed(source: string) {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  const constants = new Map<string, Node>();
  for (const item of ast.program.body as Node[]) {
    const n = item.type === 'ExportNamedDeclaration' ? item.declaration : item;
    if (n?.type === 'VariableDeclaration' && n.kind === 'const') for (const d of n.declarations) if (d.id.type === 'Identifier' && d.init) constants.set(d.id.name, d.init);
  }
  const resolve = (node: Node | undefined, seen = new Set<string>()): Node | undefined => {
    if (!node) return undefined;
    const n = unwrap(node);
    if (n.type !== 'Identifier') return n;
    if (seen.has(n.name)) return undefined;
    return constants.has(n.name) ? resolve(constants.get(n.name), new Set([...seen, n.name])) : n;
  };
  const literal = (node: Node | undefined): unknown => {
    const n = resolve(node);
    if (!n) return UNKNOWN;
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(n.type)) return n.value;
    if (n.type === 'NullLiteral') return null;
    if (n.type === 'Identifier' && n.name === 'undefined') return undefined;
    if (n.type === 'ConditionalExpression') {
      const a = literal(n.consequent); const b = literal(n.alternate);
      return a === UNKNOWN || b === UNKNOWN ? UNKNOWN : [...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])];
    }
    const concatenate = (left: unknown, right: unknown): unknown => {
      const a = Array.isArray(left) ? left : [left]; const b = Array.isArray(right) ? right : [right];
      return a.every((v) => typeof v === 'string') && b.every((v) => typeof v === 'string') ? a.flatMap((x) => b.map((y) => x + y)) : UNKNOWN;
    };
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && name(n.callee.property) === 'join') {
      const array = resolve(n.callee.object); const separator = literal(n.arguments[0]);
      if (array?.type !== 'ArrayExpression' || typeof separator !== 'string') return UNKNOWN;
      return array.elements.reduce((all: unknown, item: Node, index: number) => concatenate(concatenate(all, index ? separator : ''), literal(item)), '');
    }
    if (n.type === 'TemplateLiteral') {
      let text: unknown = n.quasis[0].value.cooked;
      for (let i = 0; i < n.expressions.length; i++) text = concatenate(concatenate(text, literal(n.expressions[i])), n.quasis[i + 1].value.cooked);
      return text;
    }
    if (n.type === 'BinaryExpression' && n.operator === '+') return concatenate(literal(n.left), literal(n.right));
    return UNKNOWN;
  };
  const body = ast.program.body as Node[];
  const exported = body.find((n) => n.type === 'ExportDefaultDeclaration')?.declaration ?? body.find((n) => n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.type === 'MemberExpression' && name(n.expression.left.object) === 'module' && name(n.expression.left.property) === 'exports')?.expression.right;
  return { ast, resolve, literal, exported };
}

function returned(fn: Node | undefined): Node | undefined {
  if (!fn) return undefined;
  if (fn.body?.type !== 'BlockStatement') return fn.body;
  const statements = fn.body.body as Node[];
  // A conditional return cannot establish one policy for every response.
  if (statements.some((n) => ['IfStatement', 'SwitchStatement', 'TryStatement'].includes(n.type))) return undefined;
  return statements.find((n) => n.type === 'ReturnStatement')?.argument;
}

export function configCsp(source: string): CspEvidence {
  try {
    const { resolve, literal, exported } = parsed(source);
    if (!exported) return 'absent';
    let config = resolve(exported);
    if (config && ['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(config.type)) config = resolve(returned(config));
    if (!config || config.type !== 'ObjectExpression') return 'unknown';
    const headers = valueOf(property(config, 'headers'));
    if (!headers) return config.properties.some((p: Node) => p.type === 'SpreadElement') ? 'unknown' : 'absent';
    const entries = resolve(returned(resolve(headers)));
    if (!entries || entries.type !== 'ArrayExpression') return 'unknown';
    const states: CspEvidence[] = [];
    let conditionalCsp = false;
    for (const raw of entries.elements as Node[]) {
      const entry = resolve(raw);
      const route = literal(valueOf(property(entry, 'source')));
      if (route === UNKNOWN) { states.push('unknown'); continue; }
      if (!['/', '/:path*', '/(.*)', '/:path(.*)', '/*'].includes(String(route))) continue;
      const list = resolve(valueOf(property(entry, 'headers')));
      if (!list || list.type !== 'ArrayExpression') { states.push('unknown'); continue; }
      for (const item of list.elements as Node[]) {
        const header = resolve(item);
        if (String(literal(valueOf(property(header, 'key')))).toLowerCase() === 'content-security-policy') {
          const conditional = ['has', 'missing'].some((key) => {
            const predicate = property(entry, key);
            if (!predicate) return false;
            const conditions = resolve(valueOf(predicate));
            return conditions?.type !== 'ArrayExpression' || conditions.elements.length !== 0;
          });
          // A matching conditional row may override/clear an unconditional row. Without
          // evaluating request predicates and ordering, their combined delivery is unknown.
          conditionalCsp ||= conditional;
          states.push(conditional ? 'unknown' : policy(literal(valueOf(property(header, 'value')))));
        }
      }
    }
    return conditionalCsp ? 'unknown' : combine(states);
  } catch { return 'unknown'; }
}

export function middlewareCsp(source: string): CspEvidence {
  try {
    const { ast, resolve, literal, exported } = parsed(source);
    const fn = resolve(exported) ?? (ast.program.body as Node[]).filter((n) => n.type === 'ExportNamedDeclaration').map((n) => n.declaration).find((n) => n?.type === 'FunctionDeclaration' && ['middleware', 'proxy'].includes(n.id?.name));
    if (!fn || fn.body?.type !== 'BlockStatement') return 'unknown';
    const responses = new Map<string, { policy: CspEvidence; escaped?: boolean }>();
    // Beyond the direct statements below, an escaped response/Headers can be mutated in ways this
    // small evaluator cannot follow. Keep that uncertainty even if a later direct set looks safe.
    const invalidate = (node: Node | undefined): void => {
      if (!node) return;
      if (node.type === 'Identifier') {
        const response = responses.get(node.name);
        if (response) { response.policy = 'unknown'; response.escaped = true; }
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        // Noncomputed property names are names, not references to local response variables.
        if (!node.computed && ((key === 'property' && ['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) || (key === 'key' && ['ObjectProperty', 'ObjectMethod'].includes(node.type)))) continue;
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child.type === 'string') invalidate(child);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') invalidate(value);
      }
    };
    const invalidateAll = (): void => {
      for (const response of responses.values()) { response.policy = 'unknown'; response.escaped = true; }
    };
    // Only simple value reads/literals are known not to execute project code. In particular, an
    // unknown zero-argument call or getter can mutate a response through a captured closure.
    const safeValue = (node: Node | undefined): boolean => {
      if (!node) return true;
      const n = unwrap(node);
      if (['Identifier', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(n.type)) return true;
      if (['FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)) return true;
      if (n.type === 'ArrayExpression') return n.elements.every(safeValue);
      if (n.type === 'ObjectExpression') return n.properties.every((p: Node) => p.type === 'ObjectProperty' && !p.computed && safeValue(p.value));
      if (n.type === 'TemplateLiteral') return n.expressions.length === 0;
      return false;
    };
    const isResponse = (n: Node | undefined) => n?.type === 'NewExpression' && name(n.callee) === 'Response' || n?.type === 'CallExpression' && n.callee.type === 'MemberExpression' && name(n.callee.object) === 'NextResponse' && ['next', 'rewrite', 'redirect', 'json'].includes(name(n.callee.property) ?? '');
    const responsePolicy = (node: Node | undefined): CspEvidence => {
      if (!node || !isResponse(node)) return 'unknown';
      const options = resolve(node.arguments[node.type === 'NewExpression' ? 1 : node.callee.property.name === 'next' ? 0 : 1]);
      const headers = resolve(valueOf(property(options, 'headers')));
      if (!headers) return 'absent';
      if (headers.type === 'ArrayExpression') {
        const entries = headers.elements.map((entry: Node) => resolve(entry));
        const pair = entries.find((entry: Node) => entry?.type === 'ArrayExpression' && String(literal(entry.elements[0])).toLowerCase() === 'content-security-policy');
        return pair ? policy(literal(pair.elements[1])) : entries.every((entry: Node) => entry?.type === 'ArrayExpression') ? 'absent' : 'unknown';
      }
      if (headers.type !== 'ObjectExpression') return 'unknown';
      const header = headers.properties.find((p: Node) => name(p.key)?.toLowerCase() === 'content-security-policy');
      return header ? policy(literal(valueOf(header))) : 'absent';
    };
    const states: CspEvidence[] = [];
    for (const stmt of fn.body.body as Node[]) {
      if (['IfStatement', 'SwitchStatement', 'TryStatement'].includes(stmt.type)) return 'unknown';
      if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) {
        if (d.id.type !== 'Identifier') { invalidateAll(); invalidate(d.init); continue; }
        if (d.init?.type === 'Identifier' && responses.has(d.init.name)) responses.set(d.id.name, responses.get(d.init.name)!);
        else if (isResponse(d.init)) {
          const safe = d.init.arguments.every(safeValue);
          if (!safe) invalidateAll();
          invalidate(d.init);
          responses.set(d.id.name, { policy: safe ? responsePolicy(d.init) : 'unknown', escaped: !safe });
        } else {
          if (!safeValue(d.init)) invalidateAll();
          invalidate(d.init);
        }
      }
      if (stmt.type === 'ExpressionStatement') {
        const call = stmt.expression;
        const receiver = call?.callee?.object;
        const response = receiver?.type === 'MemberExpression' && name(receiver.property) === 'headers' ? responses.get(name(receiver.object) ?? '') : undefined;
        if (call.type === 'CallExpression' && response) {
          // A nested helper argument may itself receive and mutate a tracked response.
          for (const arg of call.arguments) {
            const value = literal(arg);
            if (!safeValue(arg) || value === UNKNOWN || (typeof value === 'object' && value !== null)) invalidateAll();
            invalidate(arg);
          }
          const method = name(call.callee.property);
          const key = literal(call.arguments[0]);
          if (['set', 'append', 'delete'].includes(method ?? '')) {
            if (key === UNKNOWN) response.policy = 'unknown';
            else if (!response.escaped && String(key).toLowerCase() === 'content-security-policy') response.policy = method === 'delete' ? 'absent' : policy(literal(call.arguments[1]));
          } else if (!['get', 'getSetCookie', 'has', 'entries', 'keys', 'values'].includes(method ?? '')) invalidateAll();
        } else {
          if (!safeValue(call)) invalidateAll();
          // Unknown expressions can hide a response in a nested call, object, callback or Headers alias.
          invalidate(call);
        }
      } else if (!['VariableDeclaration', 'ReturnStatement'].includes(stmt.type)) {
        // Loops/blocks may execute closures without mentioning the response at their call site.
        if (!['FunctionDeclaration', 'EmptyStatement'].includes(stmt.type)) invalidateAll();
        invalidate(stmt);
      }
      if (stmt.type === 'ReturnStatement') states.push(stmt.argument?.type === 'Identifier' && responses.has(stmt.argument.name) ? responses.get(stmt.argument.name)!.policy : responsePolicy(resolve(stmt.argument)));
    }
    return combine(states);
  } catch { return 'unknown'; }
}

export function metaCspEvidence(source: string): CspEvidence {
  try {
    const { resolve, literal, exported } = parsed(source);
    const states: CspEvidence[] = [];
    const visit = (node: Node | undefined) => {
      const n = node && unwrap(node);
      if (!n) return;
      if (n.type === 'JSXFragment') { n.children.forEach(visit); return; }
      if (n.type === 'JSXElement') {
        const open = n.openingElement;
        if (open.name.name === 'meta') {
          const attr = (key: string) => open.attributes.find((a: Node) => a.type === 'JSXAttribute' && a.name.name.toLowerCase().replace('-', '') === key);
          const val = (a: Node | undefined) => a?.value?.type === 'JSXExpressionContainer' ? literal(a.value.expression) : literal(a?.value);
          if (String(val(attr('httpequiv'))).toLowerCase() === 'content-security-policy') states.push(policy(val(attr('content'))));
        }
        n.children.forEach(visit);
      } else if (n.type === 'JSXExpressionContainer' && !['JSXEmptyExpression', 'Identifier'].includes(n.expression.type)) states.push('unknown');
    };
    visit(returned(resolve(exported)));
    return combine(states);
  } catch { return 'unknown'; }
}

export function hostFileCsp(source: string): boolean {
  let root = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^\S/.test(line)) root = ['/', '/*'].includes(line.trim());
    const header = /^\s+Content-Security-Policy\s*:\s*(.*)$/i.exec(line);
    if (root && header && policy(header[1]) === 'present') return true;
  }
  return false;
}
