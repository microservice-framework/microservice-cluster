import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

import vueEslintParser from 'vue-eslint-parser';

export default [
  {
    files: ['src/*.js'],
    languageOptions: {
      parser: vueEslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        //parser: babelEslintParser,
      },
    },
  },
  {
    rules: {
      // override/add rules settings here, such as:
      'no-trailing-spaces': ['error'],
    },
  },
  eslintPluginPrettierRecommended,
];
