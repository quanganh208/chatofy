module.exports = function (api) {
  api.cache(true);
  return {
    // `jsxImportSource` and `nativewind/babel` are what turn `className` into styles.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // react-native-worklets/plugin must be listed last (RN 0.81+ replaces reanimated/plugin)
    plugins: ['react-native-worklets/plugin'],
  };
};
