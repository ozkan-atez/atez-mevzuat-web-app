process.env.NODE_ENV = 'test'

// Never allow Prisma tests to discover the application's .env database implicitly.
const testDatabase = process.env.TEST_DATABASE_URL
if (testDatabase) {
  if (!new URL(testDatabase).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test.')
  process.env.DATABASE_URL = testDatabase
} else {
  process.env.DATABASE_URL = 'postgresql://disabled:disabled@127.0.0.1:1/atez_disabled_test'
}
