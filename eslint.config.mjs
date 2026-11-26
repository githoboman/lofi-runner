import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'src/**/*', 'contracts/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
