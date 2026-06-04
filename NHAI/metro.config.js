const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { resolver: { assetExts, sourceExts } } = defaultConfig;

const config = {
  resolver: {
    // Force Metro to bundle the offline AI weights cleanly
    assetExts: [...assetExts, 'tflite', 'task'],
  },
};

module.exports = mergeConfig(defaultConfig, config);