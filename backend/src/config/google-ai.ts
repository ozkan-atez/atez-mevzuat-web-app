import { GoogleGenAI } from '@google/genai'

export function aiProvider(env: NodeJS.ProcessEnv = process.env): 'vertex' | 'gemini' {
  const flag = env.GOOGLE_GENAI_USE_VERTEXAI?.trim()
  if (flag && flag !== 'true' && flag !== 'false') throw new Error('GOOGLE_GENAI_USE_VERTEXAI true veya false olmalıdır.')
  return flag === 'true' ? 'vertex' : 'gemini'
}

export function googleAiOptions(env: NodeJS.ProcessEnv = process.env) {
  if (aiProvider(env) === 'vertex') {
    const project = env.GOOGLE_CLOUD_PROJECT?.trim()
    const location = env.GOOGLE_CLOUD_LOCATION?.trim()
    if (!project || !location) throw new Error('Vertex AI için GOOGLE_CLOUD_PROJECT ve GOOGLE_CLOUD_LOCATION gereklidir.')
    return { vertexai: true, project, location }
  }
  const apiKey = env.GEMINI_API_KEY?.trim()
  return apiKey ? { vertexai: false, apiKey } : undefined
}

/** ADC reads credentials from the runtime; never load private keys into app configuration. */
export function createGoogleAi(env: NodeJS.ProcessEnv = process.env): GoogleGenAI | undefined {
  const options = googleAiOptions(env)
  return options ? new GoogleGenAI(options) : undefined
}
