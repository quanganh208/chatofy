'use strict';

/**
 * Statusline render mode implementations: full / compact / minimal
 *
 * All rendering is config-driven via a resolved layout object (from resolveLayout()).
 * When no statuslineLayout is present in .ck.json, output is IDENTICAL to the
 * pre-refactor hardcoded renderer — zero regression guarantee.
 *
 * Mode function signatures: (ctx, layout) => void  (writes via console.log)
 */

const { red, resolveColor } = require('./colors.cjs');
const {
  DEFAULT_SECTIONS,
  getContextColorName,
  getQuotaColorName,
  getSectionRenderer
} = require('./statusline-section-registry.cjs');
const { visibleLength, getTerminalWidth } = require('./statusline-string-utils.cjs');
const { renderAgentsLines, renderTodosLine } = require('./statusline-activity-renderers.cjs');

/**
 * Look up and render a single section by ID. Shared by all render modes.
 * @param {Object[]} enabledSections - Filtered sections with enabled !== false
 * @param {string} id - Section ID
 * @param {Object} ctx - Render context
 * @param {Object} theme - Theme config
 * @returns {string} Rendered section text, or '' if disabled/missing
 */
function renderSection(enabledSections, id, ctx, theme) {
  const sec = enabledSections.find(s => s.id === id);
  if (!sec) return '';
  const fn = getSectionRenderer(id);
  return (fn && fn(ctx, sec, theme)) || '';
}

/**
 * Build the joiner used between sections on one line.
 * With no separator configured the result is the historical double space.
 * @param {Object} layout - Resolved layout
 * @returns {(parts: string[]) => string}
 */
function makeJoiner(layout) {
  const glyph = layout.separator;
  if (!glyph) return (parts) => parts.filter(Boolean).join('  ');
  const sep = ` ${resolveColor(layout.theme?.separator || 'dim')(glyph)} `;
  return (parts) => parts.filter(Boolean).join(sep);
}

/**
 * Render configured lines from layout.configLines (user's lines[][] config).
 * Each configured line renders its sections in order, separated by spaces.
 * Agents and todos are excluded — handled separately by render().
 */
function renderConfiguredLines(ctx, layout) {
  const effectiveSections = layout.sections.length > 0 ? layout.sections : DEFAULT_SECTIONS;
  const enabledSections = effectiveSections.filter(s => s.enabled !== false);
  const rs = (id) => renderSection(enabledSections, id, ctx, layout.theme);
  const join = makeJoiner(layout);

  const lines = [];
  for (const configLine of layout.configLines) {
    // Skip agents/todos — they're handled as multi-line sections by render()
    const ids = configLine.filter(id => id !== 'agents' && id !== 'todos');
    if (ids.length === 0) continue;
    const rendered = join(ids.map(rs));
    if (rendered) lines.push(rendered);
  }
  return lines;
}

/**
 * Build session lines using responsive wrapping (legacy, when no lines config).
 * @param {Object} ctx    - Render context
 * @param {Object} layout - Resolved layout from resolveLayout()
 * @returns {string[]}
 */
function renderSessionLines(ctx, layout) {
  // If user configured lines via dashboard, render them directly
  if (layout.configLines && layout.configLines.length > 0) {
    return renderConfiguredLines(ctx, layout);
  }

  // Legacy responsive wrapping for backward compat (no lines config)
  const termWidth = getTerminalWidth();
  const threshold = Math.floor(termWidth * (layout.responsiveBreakpoint || 0.85));
  const effectiveSections = layout.sections.length > 0 ? layout.sections : DEFAULT_SECTIONS;
  const enabledSections = effectiveSections.filter(s => s.enabled !== false);

  const rs = (id) => renderSection(enabledSections, id, ctx, layout.theme);
  const join = makeJoiner(layout);

  const dirPart    = rs('directory');
  const branchPart = rs('git');
  const planPart   = rs('plan');
  const sessionPart = join(['model', 'context', 'quota'].map(rs));
  const statsPart = join(['cost', 'changes'].map(rs));

  const locationPart = join([dirPart, branchPart, planPart]);
  const locationLen  = visibleLength(locationPart);
  const statsLen     = visibleLength(statsPart);

  const allOneLine     = join([sessionPart, locationPart, statsPart]);
  const sessionLocation = join([sessionPart, locationPart]);
  const sessionStats    = join([sessionPart, statsPart]);

  const lines = [];
  if (visibleLength(allOneLine) <= threshold && statsLen > 0) {
    lines.push(allOneLine);
  } else if (visibleLength(sessionLocation) <= threshold) {
    lines.push(sessionLocation);
    if (statsLen > 0) lines.push(statsPart);
  } else if (locationLen <= threshold) {
    lines.push(locationPart);
    if (statsLen > 0 && visibleLength(sessionStats) <= threshold) {
      lines.push(sessionStats);
    } else {
      lines.push(sessionPart);
      if (statsLen > 0) lines.push(statsPart);
    }
  } else {
    if (dirPart)    lines.push(dirPart);
    if (branchPart) lines.push(branchPart);
    if (planPart)   lines.push(planPart);
    lines.push(sessionPart);
    if (statsLen > 0) lines.push(statsPart);
  }

  return lines;
}

/**
 * Full render: session lines + optional agents + optional todos.
 * @param {Object}  ctx
 * @param {Object}  layout
 * @param {boolean} singleLineMode - Skip agents/todos when true
 */
function render(ctx, layout, singleLineMode) {
  const lines = [...renderSessionLines(ctx, layout)];

  if (!singleLineMode) {
    const effectiveSectionsForEnabled = layout.sections.length > 0 ? layout.sections : DEFAULT_SECTIONS;
    const isEnabled = id => effectiveSectionsForEnabled.some(s => s.id === id && s.enabled !== false);
    const getSectionConfig = id => effectiveSectionsForEnabled.find(s => s.id === id && s.enabled !== false) || {};

    // Show idle placeholder for agents when agents is explicitly placed in configLines[][].
    // This ensures full mode outputs all N configured rows (compact mode slices via slice(0,2)).
    const agentsInConfigLines = !!(layout.configLines && layout.configLines.some(row => Array.isArray(row) && row.includes('agents')));

    if (isEnabled('agents')) {
      lines.push(...renderAgentsLines(ctx.transcript, layout.maxAgentRows, getSectionConfig('agents'), agentsInConfigLines));
    }
    if (isEnabled('todos')) {
      const todosLine = renderTodosLine(ctx.transcript, layout.todoTruncation, getSectionConfig('todos'));
      if (todosLine) lines.push(todosLine);
    }
  }

  for (const line of lines) console.log(line);
}

/**
 * Compact render: 2 lines — session info then location.
 * @param {Object} ctx
 * @param {Object} layout
 */
function renderCompact(ctx, layout) {
  if (layout.configLines && layout.configLines.length > 0) {
    // Use configured lines — show first 2 lines only (compact)
    const lines = renderConfiguredLines(ctx, layout);
    for (const line of lines.slice(0, 2)) console.log(line);
    return;
  }
  // Legacy fallback
  const effectiveSections = layout.sections.length > 0 ? layout.sections : DEFAULT_SECTIONS;
  const enabledSections = effectiveSections.filter(s => s.enabled !== false);
  const rs = (id) => renderSection(enabledSections, id, ctx, layout.theme);
  const join = makeJoiner(layout);

  console.log(join(['model', 'context', 'quota'].map(rs)));
  console.log(join(['directory', 'git'].map(rs)));
}

/**
 * Minimal render: single line with battery-style context indicator.
 * Overrides the context section with a battery icon instead of a progress bar.
 * @param {Object} ctx
 * @param {Object} layout
 */
function renderMinimal(ctx, layout) {
  if (layout.configLines && layout.configLines.length > 0) {
    // Use configured lines — show first line only (minimal)
    const lines = renderConfiguredLines(ctx, layout);
    if (lines.length > 0) console.log(lines[0]);
    return;
  }
  // Legacy fallback
  const effectiveSections = layout.sections.length > 0 ? layout.sections : DEFAULT_SECTIONS;
  const enabledSections = effectiveSections.filter(s => s.enabled !== false);
  const isEnabled = id => enabledSections.some(s => s.id === id);
  const rs = (id) => renderSection(enabledSections, id, ctx, layout.theme);
  const getSectionConfig = (id) => enabledSections.find(s => s.id === id) || {};
  const themeOverrides = layout.themeOverrides || {};

  const parts = [];

  if (isEnabled('model'))   parts.push(rs('model'));

  // Minimal mode: battery icon instead of progress bar
  if (ctx.contextPercent > 0 && isEnabled('context')) {
    const batteryConfig = getSectionConfig('context');
    const batteryGlyph = batteryConfig.icon || '🔋';
    const hasCustomContextTheme = ['contextLow', 'contextMid', 'contextHigh']
      .some((key) => Object.prototype.hasOwnProperty.call(themeOverrides, key));
    const batteryIcon = hasCustomContextTheme
      ? resolveColor(getContextColorName(ctx.contextPercent, layout.theme))(batteryGlyph)
      : (ctx.contextPercent > 70 ? red(batteryGlyph) : batteryGlyph);
    parts.push(`${batteryIcon} ${ctx.contextPercent}%`);
  }

  if (ctx.usageWindows?.length > 0 && isEnabled('quota')) {
    const quotaConfig = getSectionConfig('quota');
    const quotaText = ctx.usageWindows.join('  ');
    const quotaColor = quotaConfig.color || getQuotaColorName(ctx.usageWindows, layout.theme);
    parts.push(`${quotaConfig.icon || '⏰'} ${resolveColor(quotaColor)(quotaText)}`);
  }

  if (ctx.gitBranch && isEnabled('git')) {
    parts.push(rs('git'));
  }

  if (isEnabled('directory')) parts.push(rs('directory'));

  console.log(makeJoiner(layout)(parts));
}

module.exports = { renderSessionLines, render, renderCompact, renderMinimal };
