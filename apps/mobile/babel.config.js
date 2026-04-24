module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin must be listed last (RN 0.81+ replaces reanimated/plugin)
    plugins: ['react-native-worklets/plugin'],
  };
};
