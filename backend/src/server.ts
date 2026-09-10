import { buildApp } from './app'

async function start() {
  const app = await buildApp()

  try {
    const port = parseInt(process.env.PORT || '3000', 10)
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`🚀 Server listening on http://0.0.0.0:${port}`)
  } catch (err) {
    console.error('Error starting server:', err)
    process.exit(1)
  }
}

start()
