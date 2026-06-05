// Root barrel — re-exports all sub-modules for consumers using the `.` export path.
// Each sub-barrel uses explicit named exports with no cross-barrel name overlap,
// so `export *` here cannot produce ambiguous re-exports.
// The api (moduleResolution: "node") can only resolve this root barrel, not the
// `exports` subpaths — so every shared schema must be reachable from here.
export * from './domain/index.js';
export * from './http/index.js';
export * from './events/index.js';
