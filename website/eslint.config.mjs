import { defineConfig, globalIgnores } from 'eslint/config'
import nextConfig from 'eslint-config-next'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextConfig,
  ...nextTs,
  {
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'next-env.d.ts',
  ]),
])
