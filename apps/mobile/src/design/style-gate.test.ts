/**
 * The mobile style gate: what docs/design-guidelines.md asks of a mobile screen,
 * checked over every source file instead of left to review.
 *
 * - No raw colour (hex, rgb/rgba, hsl/hsla) in code: colours are the palette
 *   variables `className` reads, set at runtime from @chatofy/ui.
 * - No `dark:` variant and no colour opacity modifier (`bg-primary/90`) in a class
 *   string. The variables already change with the theme, and they hold hex values,
 *   so NativeWind has no channel to apply an opacity to — both do nothing.
 * - No vector-icon font imports: icons are lucide through `components/ui/icon`.
 * - No legacy styling (`StyleSheet` from react-native, the colours `useTheme()`
 *   returns, or palette values imported from @chatofy/ui) outside
 *   `LEGACY_STYLE_FILES`.
 * - At most one accent-filled control per screen state, in every file under `app/`
 *   and `src/components/`, legacy ones included — the accent budget.
 *
 * The accent budget is an approximation. Web counts accent-filled controls per
 * screen STATE by rendering each state (apps/web/src/design/accent-budget-app.spec.tsx);
 * these tests run in plain Node with no React Native renderer, so a state here is
 * the nearest `return` (or arrow body) around the element, read statically. An
 * accent is a default-variant `<Button>`, a component that exists to draw one
 * (`AuthSubmit`, `AuthNextStep`, `PrimaryButton`), or an element whose literal
 * `className` fills `bg-primary`. It misses a computed `variant`, a class string
 * held in a variable, and an accent drawn by some other child component; it flags
 * two accents in a ternary under one `return` — make one quiet or split the return.
 * Class strings held in variables also escape the `dark:`/opacity check.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gatedFiles, scanSource } from './style-gate-scan.ts';

const APP_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Files still styled with `StyleSheet` or `useTheme()` colours. Enforced in both
 * directions, like web's `KNOWN_VIOLATIONS`: a file missing from here fails, and so
 * does a row whose file has moved to `className` or no longer exists. Moving a
 * screen to `className` means deleting its row in the same change. Never add one.
 */
const LEGACY_STYLE_FILES = new Set([
  'app/(app)/conference/[roomId].tsx',
  'app/(app)/conference/ended.tsx',
  'app/(app)/conference/index.tsx',
  'app/(app)/history/[conversationId].tsx',
  'app/(app)/history/_layout.tsx',
  'app/(app)/history/index.tsx',
  'app/(app)/settings.tsx',
  'app/(app)/translate.tsx',
  'app/index.tsx',
  'src/billing/credits-summary.tsx',
  'src/components/conference/call-control-bar.tsx',
  'src/components/conference/chat-panel.tsx',
  'src/components/conference/language-picker.tsx',
  'src/components/conference/participant-sheet.tsx',
  'src/components/conference/participant-tile.tsx',
  'src/components/conference/subtitle-overlay.tsx',
  'src/components/conference/transcript-sheet.tsx',
  'src/components/conference/video-grid.tsx',
  'src/components/conference/voice-gender-picker.tsx',
  'src/components/translate/language-bar.tsx',
  'src/components/translate/status-strip.tsx',
  'src/components/translate/translate-controls.tsx',
  'src/components/translate/turn-list.tsx',
  'src/components/translate/voice-sheet.tsx',
  'src/ui/components/bottom-sheet.tsx',
  'src/ui/components/ghost-button.tsx',
  'src/ui/components/inline-notice.tsx',
  'src/ui/components/list-row.tsx',
  'src/ui/components/primary-button.tsx',
  'src/ui/components/screen.tsx',
  'src/ui/components/text-field.tsx',
]);

const files = gatedFiles(APP_ROOT);
const scans = files.map((path) => ({
  path,
  ...scanSource(path, readFileSync(join(APP_ROOT, path), 'utf8')),
}));

const report = (rows: string[]) => `\n  ${rows.join('\n  ')}\n`;

describe('mobile style gate', () => {
  it('scans the app', () => {
    assert.ok(
      files.includes('app/(app)/settings.tsx') && files.length > 50,
      `scanned ${files.length}`,
    );
  });

  it('writes no raw colour in code', () => {
    const rows = scans.flatMap((s) => s.colourLiterals.map((hit) => `${s.path}:${hit}`));
    assert.deepEqual(rows, [], `use a palette class or useTheme() colour:${report(rows)}`);
  });

  it('writes no dark: variant or colour opacity modifier in a class string', () => {
    const rows = scans.flatMap((s) => s.classProblems.map((hit) => `${s.path}:${hit}`));
    assert.deepEqual(rows, [], `drop these; the variables follow the theme:${report(rows)}`);
  });

  it('imports no vector-icon font', () => {
    const rows = scans.flatMap((s) => s.iconImports.map((hit) => `${s.path}:${hit}`));
    assert.deepEqual(rows, [], `use lucide through @/components/ui/icon:${report(rows)}`);
  });

  it('keeps legacy styling to the files listed in LEGACY_STYLE_FILES', () => {
    const unlisted = scans.filter((s) => s.legacy && !LEGACY_STYLE_FILES.has(s.path));
    assert.deepEqual(
      unlisted.map((s) => s.path),
      [],
      'style these with className instead of StyleSheet / useTheme() colours',
    );
  });

  it('lists no file in LEGACY_STYLE_FILES that has moved on', () => {
    const stale = [...LEGACY_STYLE_FILES].filter(
      (path) => !existsSync(join(APP_ROOT, path)) || !scans.find((s) => s.path === path)?.legacy,
    );
    assert.deepEqual(stale, [], `no longer legacy or gone — delete these rows:${report(stale)}`);
  });

  it('draws at most one accent-filled control per screen state', () => {
    const rows = scans
      .filter((s) => /^(app|src\/components)\//.test(s.path))
      .flatMap((s) =>
        s.accentGroups.filter((g) => g.length > 1).map((g) => `${s.path}: lines ${g.join(', ')}`),
      );
    assert.deepEqual(
      rows,
      [],
      `one accent-filled control per screen; make the rest quiet:${report(rows)}`,
    );
  });
});

describe('scanSource', () => {
  it('finds colour literals in code but not in comments', () => {
    const src =
      "// '#fff' is fine here\nconst a = '#1C1917';\nconst b = `rgba(0, 0, 0, ${x})`;\nconst c = 'Room #12';";
    assert.deepEqual(scanSource('a.tsx', src).colourLiterals, ['2: #1C1917', '3: rgba(0, 0, 0, ']);
  });

  it('flags dark: and colour opacity only inside class strings', () => {
    const src =
      'const a = <View className="bg-card dark:bg-muted active:bg-primary/90 w-1/2" />;\n' +
      "const b = cn('text-foreground', { web: 'focus-visible:ring-ring/50' });\nconst c = 'dark:x';";
    assert.deepEqual(scanSource('a.tsx', src).classProblems, [
      '1: dark:bg-muted',
      '1: active:bg-primary/90',
      '2: focus-visible:ring-ring/50',
    ]);
  });

  it('tells legacy styling from a scheme read', () => {
    const legacy = (src: string) => scanSource('a.tsx', src).legacy;
    assert.equal(legacy("import { StyleSheet, View } from 'react-native';"), true);
    assert.equal(legacy('const { colors } = useTheme();'), true);
    assert.equal(legacy('const c = useTheme().colors;'), true);
    assert.equal(legacy('const theme = useTheme();\nconst c = theme.colors.text;'), true);
    assert.equal(legacy("import { palettes, space } from '@chatofy/ui';"), true);
    assert.equal(legacy("import { space, radius } from '@chatofy/ui';"), false);
    assert.equal(legacy('const { scheme } = useTheme();'), false);
    assert.equal(
      legacy("import { View } from 'react-native'; // was StyleSheet, useTheme()"),
      false,
    );
  });

  it('counts only default-variant Buttons', () => {
    const src =
      '<><Button /><Button variant="default">a</Button><Button variant="outline" />' +
      '<Button variant={quiet ? "ghost" : "default"} /></>';
    assert.deepEqual(scanSource('a.tsx', src).accentGroups, [[1, 1]]);
  });

  it('counts accents per screen state, not per file', () => {
    const src = [
      'function A() {',
      '  if (done) return <AuthNextStep />;',
      '  return <AuthScreen><AuthSubmit /></AuthScreen>;',
      '}',
      'function B() {',
      '  return <><PrimaryButton /><Pressable className="rounded-md bg-primary" /></>;',
      '}',
      'const C = () => <Pressable className="bg-primary/90 bg-muted" />;',
    ].join('\n');
    assert.deepEqual(scanSource('a.tsx', src).accentGroups, [[2], [3], [6, 6]]);
  });

  it('flags vector-icon imports', () => {
    const src =
      "import Ionicons from '@expo/vector-icons/Ionicons';\nimport { X } from 'lucide-react-native';";
    assert.deepEqual(scanSource('a.tsx', src).iconImports, ['1: @expo/vector-icons/Ionicons']);
  });
});
