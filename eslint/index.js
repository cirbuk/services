module.exports = {
  extends: [
    './non-rules.js', // Shared Global settings
    './base.js', // Base configuration rules
    './prettier.js', // Custom Prettier rules
    './import.js', // Base `eslint-plugin-import` rules
  ],
  parser: '@babel/eslint-parser',
  rules: {},
};
