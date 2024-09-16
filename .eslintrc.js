module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    
    semi: ['error', 'never'],
    "unused-imports/no-unused-imports": "error"    
    
  },
  plugins: ['unused-imports']
}
