import { buildApp } from './app'
import { loadEnv } from './config/env'

async function start() {
  const app = await buildApp()

  try {
    const port = loadEnv().port
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 Server listening on http://0.0.0.0:${port}`)
  } catch (err) {
    console.error('Error starting server:', err)
    process.exit(1)
  }
}

start()
