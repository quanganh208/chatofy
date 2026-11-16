// What the mobile style gate reads out of one source file.
//
// The file is parsed with the TypeScript compiler rather than matched with
// regular expressions over raw text, so a comment that quotes a forbidden
// pattern ("no `dark:` here", "used to be useTheme()") is never a finding and a
// class string is recognised by where it sits, not by what it looks like.

import { readdirSync } from 'node:fs';
import ts from 'typescript';

export interface StyleFindings {
  /** `line: literal` for every hex, rgb/rgba or hsl/hsla colour written in code. */
  colourLiterals: string[];
  /** `line: token` for `dark:` variants and colour opacity modifiers in class strings. */
  classProblems: string[];
  /** `line: specifier` for vector-icon or Ionicons imports. */
  iconImports: string[];
  /**
   * Imports `StyleSheet` from react-native, reads the colours `useTheme()` returns
   * (destructured, or through any name bound to the call), or imports palette
   * values from @chatofy/ui to style with directly.
   */
  legacy: boolean;
  /**
   * Accent-filled controls, grouped by the screen state that draws them: one group
   * per `return` (or arrow body) that renders JSX, each holding element lines.
   */
  accentGroups: number[][];
}

const HEX_COLOUR = /(?:^|[^\w&])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;
const FUNCTION_COLOUR = /\b(?:rgba?|hsla?)\(/i;
// A colour utility followed by `/<opacity>`: with the palette held in hex
// variables NativeWind has no channel to apply the opacity to, so it does nothing.
const COLOUR_OPACITY =
  /^(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|divide|placeholder|fill|stroke|shadow|decoration|caret|from|via|to)-[a-z][\w-]*\/(?:\d+|\[[^\]]+\])$/;
const CLASS_HELPERS = new Set(['cn', 'cva', 'clsx', 'twMerge']);

function isClassContext(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isJsxAttribute(at)) return /className$/i.test(at.name.getText());
    if (ts.isCallExpression(at) && CLASS_HELPERS.has(at.expression.getText())) return true;
    if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false;
  }
  return false;
}

function classProblemsIn(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const variants = token.split(':');
      return variants.slice(0, -1).includes('dark') || COLOUR_OPACITY.test(variants.at(-1)!);
    });
}

function isUseThemeCall(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'useTheme'
  );
}

/** The literal value of a JSX attribute, or `undefined` when it is computed. */
function attributeLiteral(attribute: ts.JsxAttribute): string | undefined {
  const init = attribute.initializer;
  if (init && ts.isStringLiteral(init)) return init.text;
  if (init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
    return init.expression.text;
  }
  return undefined;
}

// Components whose whole job is to draw the screen's one accent-filled control.
const ACCENT_COMPONENTS = new Set(['AuthSubmit', 'AuthNextStep', 'PrimaryButton']);
const PALETTE_EXPORTS = new Set(['palettes', 'color', 'colorLight']);

/** A legacy fill: `style` sets `backgroundColor` to `<theme>.primary` (`accent` there is the speaking hue). */
function fillsPrimaryInStyle(element: ts.JsxOpeningLikeElement): boolean {
  const style = element.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'style',
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'backgroundColor' &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === 'primary'
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  if (style?.initializer) visit(style.initializer);
  return found;
}

/**
 * True when an element is accent-filled: a `<Button>` on the default variant (no
 * `variant`, or `variant="default"`), a component that exists to draw one, or any
 * element whose literal `className` fills `bg-primary`.
 */
function isAccent(element: ts.JsxOpeningLikeElement): boolean {
  const tag = element.tagName.getText();
  if (ACCENT_COMPONENTS.has(tag)) return true;
  const className = element.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'className',
  );
  const classes = className && attributeLiteral(className);
  if (classes?.split(/\s+/).includes('bg-primary')) return true;
  if (fillsPrimaryInStyle(element)) return true;
  if (tag !== 'Button') return false;
  const variant = element.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'variant',
  );
  // A computed variant is not counted: the gate cannot know which branch draws.
  return variant === undefined || attributeLiteral(variant) === 'default';
}

/**
 * True for a function written inline in JSX — a `.map` callback or a render prop.
 * It draws into the element around it, so it is not a screen state of its own.
 */
function isInlineInJsx(fn: ts.Node): boolean {
  for (let at: ts.Node | undefined = fn.parent; at; at = at.parent) {
    if (ts.isJsxExpression(at) || ts.isJsxAttribute(at)) return true;
    if (ts.isFunctionLike(at) || ts.isSourceFile(at) || ts.isBlock(at)) return false;
  }
  return false;
}

/**
 * Where an element is drawn: a screen state (the nearest `return` statement or
 * arrow expression body of a component), or, for JSX hoisted into a variable,
 * the component itself. Early returns are the states a screen switches between,
 * so two accents under different returns are never on screen together. Functions
 * written inline in JSX are looked through, so a `.map` callback or a render
 * prop counts with the element it draws into.
 */
function placeOf(node: ts.Node): { state: ts.Node; owner: ts.Node; hoisted: boolean } {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    const isState =
      ts.isReturnStatement(at) ||
      (ts.isArrowFunction(at) && !ts.isBlock(at.body) && contains(at.body, node));
    if (isState) {
      // The function this return (or arrow body) belongs to; one written inline in
      // JSX is looked through, so its return is not a state of its own.
      const own = ts.isArrowFunction(at) ? at : nearestFunction(at);
      if (own !== undefined && isInlineInJsx(own)) continue;
      return { state: at, owner: own ?? at.getSourceFile(), hoisted: false };
    }
    if (ts.isFunctionLike(at) && !isInlineInJsx(at)) return { state: at, owner: at, hoisted: true };
    if (ts.isSourceFile(at)) return { state: at, owner: at, hoisted: true };
  }
  const file = node.getSourceFile();
  return { state: file, owner: file, hoisted: true };
}

function nearestFunction(node: ts.Node): ts.Node | undefined {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isFunctionLike(at)) return at;
  }
  return undefined;
}

function contains(outer: ts.Node, node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at; at = at.parent) if (at === outer) return true;
  return false;
}

export function scanSource(fileName: string, source: string): StyleFindings {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: StyleFindings = {
    colourLiterals: [],
    classProblems: [],
    iconImports: [],
    legacy: false,
    accentGroups: [],
  };
  const groups = new Map<ts.Node, { owner: ts.Node; hoisted: boolean; lines: number[] }>();
  // Names bound to `useTheme()`, so `theme.colors` is caught as well as `{ colors }`.
  const themeNames = new Set<string>();
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const text = node.text;
      if (HEX_COLOUR.test(text) || FUNCTION_COLOUR.test(text)) {
        findings.colourLiterals.push(`${lineOf(node)}: ${text}`);
      }
      if (isClassContext(node)) {
        for (const token of classProblemsIn(text))
          findings.classProblems.push(`${lineOf(node)}: ${token}`);
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const names = node.importClause?.getText() ?? '';
      if (/vector-icons|ionicons/i.test(from) || /\bIonicons\b/.test(names)) {
        findings.iconImports.push(`${lineOf(node)}: ${from}`);
      }
      if (from === 'react-native' && /\bStyleSheet\b/.test(names)) findings.legacy = true;
      const bindings = node.importClause?.namedBindings;
      if (
        from === '@chatofy/ui' &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((e) => PALETTE_EXPORTS.has((e.propertyName ?? e.name).text))
      ) {
        findings.legacy = true;
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isUseThemeCall(node.initializer)
    ) {
      themeNames.add(node.name.text);
    }
    // `const { colors } = useTheme()` and `useTheme().colors`; `{ scheme }` alone is not legacy.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      isUseThemeCall(node.initializer) &&
      node.name.elements.some((e) => (e.propertyName ?? e.name).getText() === 'colors')
    ) {
      findings.legacy = true;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'colors' &&
      (isUseThemeCall(node.expression) ||
        (ts.isIdentifier(node.expression) && themeNames.has(node.expression.text)))
    ) {
      findings.legacy = true;
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isAccent(node)) {
      const { state, owner, hoisted } = placeOf(node);
      const group = groups.get(state) ?? { owner, hoisted, lines: [] };
      group.lines.push(lineOf(node));
      groups.set(state, group);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Hoisted JSX is drawn by whichever return uses it: count it with each of its
  // component's states, or on its own when the component has none with an accent.
  const all = [...groups.values()];
  const counted: number[][] = [];
  for (const hoisted of all.filter((g) => g.hoisted)) {
    const states = all.filter((g) => !g.hoisted && g.owner === hoisted.owner);
    if (states.length === 0) counted.push(hoisted.lines);
    for (const state of states) state.lines.push(...hoisted.lines);
  }
  for (const g of all.filter((g) => !g.hoisted)) counted.push(g.lines);
  findings.accentGroups = counted
    .map((lines) => [...lines].sort((x, y) => x - y))
    .sort((x, y) => x[0]! - y[0]!);
  return findings;
}

// Modules that hold the palette on purpose: the theme tables, the navigation
// colours React Navigation needs as values, and the depth helper.
const EXEMPT = [
  /^src\/ui\/theme[^/]*\.ts$/,
  /^src\/ui\/navigation-colors\.ts$/,
  /^src\/ui\/elevation\.ts$/,
  /\.test\.tsx?$/,
];

/** Every gated file under `app/` (tsx) and `src/` (ts, tsx), as a posix path from the app root. */
export function gatedFiles(appRoot: string): string[] {
  const list = (dir: string, pattern: RegExp) =>
    readdirSync(`${appRoot}/${dir}`, { recursive: true, encoding: 'utf8' })
      .map((path) => `${dir}/${path.split('\\').join('/')}`)
      .filter((path) => pattern.test(path));
  return [...list('app', /\.tsx$/), ...list('src', /\.tsx?$/)]
    .filter((path) => !path.endsWith('.d.ts') && !EXEMPT.some((rule) => rule.test(path)))
    .sort();
}
