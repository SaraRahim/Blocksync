const webpack = require('webpack');

module.exports = function override(config) {
  // Add fallbacks for Node.js core modules
  config.resolve.fallback = {
    ...config.resolve.fallback,
    process: require.resolve('process/browser'),
    buffer: require.resolve('buffer'),  // Changed from 'buffer/'
    stream: require.resolve('stream-browserify'),
    crypto: require.resolve('crypto-browserify'),
    util: require.resolve('util/'),
    assert: require.resolve('assert/')
  };

  // Add process and Buffer polyfills
  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    })
  ];

  return config;
}