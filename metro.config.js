const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const { withSentryConfig } = require("@sentry/react-native/metro");

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Ensure Metro can resolve .cjs files (CommonJS modules)
    sourceExts: ['jsx', 'js', 'ts', 'tsx', 'json', 'cjs'],
    // Workaround for Unicode character issues in @noble/curves
    // Files with Greek letters (β, α) cause "Property β does not exist" errors in Hermes
    /*resolveRequest: (context, moduleName, platform) => {
      // Force cashu-ts to use pre-built CJS bundle
      if (moduleName === '@cashu/cashu-ts') {
        return {
          filePath: context.resolveRequest(context, '@cashu/cashu-ts/lib/cashu-ts.cjs', platform).filePath,
          type: 'sourceFile',
        };
      }

      // Block problematic @noble/curves files that contain Unicode characters
      // Allow only essential modules needed for secp256k1
      if (moduleName.startsWith('@noble/curves/')) {
        const allowed = [
          'secp256k1',
          'abstract/modular',
          'abstract/weierstrass',
          '_shortw_utils',
          'utils'
        ];
        const isAllowed = allowed.some(path => moduleName.includes(path));

        if (!isAllowed) {
          // Return empty stub for blocked imports (contains Unicode chars incompatible with Hermes)
          const stubPath = require('path').resolve(__dirname, 'node_modules/.metro-stub.js');
          return {
            filePath: stubPath,
            type: 'sourceFile',
          };
        }
      }

      // Default resolution
      return context.resolveRequest(context, moduleName, platform);
    },*/
  },
};

module.exports = withSentryConfig(mergeConfig(getDefaultConfig(__dirname), config));
