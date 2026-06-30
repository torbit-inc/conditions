// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Shared-library lint config. Non-destructive by design: prettier is NOT wired
// in and there is no `--fix` anywhere — `npm run lint` only reports.
// Non-type-checked recommended set keeps it fast and avoids any-propagation noise.
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'eslint.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Tests and CJS build/check scripts legitimately use require().
    files: [
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/__tests__/**/*.ts',
      '**/scripts/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
