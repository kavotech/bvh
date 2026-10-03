import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores:['dist/**','node_modules/**','scripts/upgrade-site.mjs'] },
  js.configs.recommended,
  { files:['**/*.{js,mjs}'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node}},rules:{'no-unused-vars':['warn',{argsIgnorePattern:'^_',caughtErrors:'none'}]} },
];
