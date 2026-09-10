import { FastifyInstance } from 'fastify'

export async function authRoutes(app: FastifyInstance) {
  
  // Dummy middleware (Hook) to simulate OIDC session/token check
  app.addHook('preHandler', async (request, reply) => {
    const authHeader = request.headers.authorization
    
    // For test verification: Reject if token is missing or not 'mock-token'
    if (!authHeader || authHeader !== 'Bearer mock-token') {
      return reply.code(401).send({ 
        error: 'Unauthorized', 
        message: 'Geçersiz veya eksik token. Lütfen giriş yapın.' 
      })
    }
  })

  // GET /api/auth/me
  app.get('/me', async (request, reply) => {
    // In a real app, user info would be fetched from DB using the decoded token
    return { 
      user: {
        id: 'admin-123',
        email: 'admin@atez.com',
        role: 'ADMIN'
      }
    }
  })
}
