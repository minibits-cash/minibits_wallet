module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [    
      [
          'module-resolver',
          {
          alias: {
              'crypto': 'react-native-quick-crypto',
              'stream': 'stream-browserify',
              'buffer': '@craftzdog/react-native-buffer',
          },
          },
      ],    
      'module:react-native-dotenv',
      'react-native-reanimated/plugin',
      '@babel/plugin-proposal-export-namespace-from',
      'hot-updater/babel-plugin', 
  ],
};
