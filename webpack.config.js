const webpack = require('webpack');

module.exports = {
  resolve: {
    fallback: {
      dgram: false, // No browser equivalent, must be replaced in code
      net: false, // No browser equivalent
      dns: false, // No browser equivalent
      process: require.resolve("process/browser"),
      stream: require.resolve("stream-browserify"),
      buffer: require.resolve("buffer/"),
      crypto: require.resolve("crypto-browserify"),
      util: require.resolve("util/"),
      assert: require.resolve("assert/"),
      path: require.resolve("path-browserify")
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser",
      Buffer: ["buffer", "Buffer"]
    }),
  ],
};