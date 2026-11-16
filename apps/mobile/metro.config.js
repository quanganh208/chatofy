const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo
config.watchFolders = [workspaceRoot];

// Resolve modules from both project and workspace root.
// pnpm virtual store paths require hierarchical lookup enabled so metro can
// traverse up from .pnpm/<pkg>/node_modules to find hoisted packages.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `inlineRem: 16` makes 1rem 16px, the size the Tailwind numeric spacing scale
// assumes: `p-4` is 16, `gap-6` is 24 — the same steps as `space` in @chatofy/ui.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
