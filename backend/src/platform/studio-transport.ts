/** Shared by API and report workers. Embedded calls never open a network port. */
interface EmbeddedStudio {
  fetch: typeof fetch
  close(): Promise<void>
}

let instance: Promise<EmbeddedStudio> | undefined
const embeddedOrigin = 'http://embedded-studio'

async function getStudio(): Promise<EmbeddedStudio> {
  if (!instance) {
    const entry = new URL('../../workflow/apps/studio/src/embedded.ts', import.meta.url).href
    instance = import(entry).then(module => module.createEmbeddedStudio(process.env))
    instance = instance!.catch(error => { instance = undefined; throw error })
  }
  return instance
}

export async function initializeEmbeddedStudio() {
  if (process.env.COMPONENT_STUDIO_URL === embeddedOrigin) await getStudio()
}

export const studioFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (url.origin !== embeddedOrigin) return fetch(input, init)
  return (await getStudio()).fetch(input, init)
}

export async function closeEmbeddedStudio() {
  const current = instance
  instance = undefined
  if (current) await (await current).close()
}
