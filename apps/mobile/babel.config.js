// Babel config for Expo — reanimated plugin MUST be last
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated/plugin must always be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
