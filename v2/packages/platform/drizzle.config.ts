import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/platform/src/db/schema/index.ts',
  out: './packages/platform/migrations',
})
