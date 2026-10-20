import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Os testes de integração compartilham um banco de teste; arquivos rodam em sequência.
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/blingstock_test',
      NODE_ENV: 'test',
      BLING_CLIENT_SECRET: 'segredo-de-teste',
      ANTHROPIC_API_KEY: '',
      // Testes nunca chamam IA externa (o .env local pode ter chaves).
      AI_PROVIDER: 'local',
    },
  },
});
