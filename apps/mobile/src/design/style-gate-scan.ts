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
  /** Imports `StyleSheet` from react-native or reads the colours `useTheme()` returns. */
  legacy: boolean;
  /** Lines of `<Button>` elements drawn with the default (accent-filled) variant. */
  defaultButtons: number[];
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

/** True when a `<Button>` takes the default variant: no `variant`, or `variant="default"`. */
function isDefaultButton(element: ts.JsxOpeningLikeElement): boolean {
  if (element.tagName.getText() !== 'Button') return false;
  const variant = element.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'variant',
  );
  // A computed variant is not counted: the gate cannot know which branch draws.
  return variant === undefined || attributeLiteral(variant) === 'default';
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
    defaultButtons: [],
  };
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
      isUseThemeCall(node.expression)
    ) {
      findings.legacy = true;
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isDefaultButton(node)
    ) {
      findings.defaultButtons.push(lineOf(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
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
