module.exports = {
  root: true,
  extends: '@react-native-community',
  rules: {
    
    semi: ['error', 'never'],
    "unused-imports/no-unused-imports": "error"    
    
  },
  plugins: ['unused-imports']
}
