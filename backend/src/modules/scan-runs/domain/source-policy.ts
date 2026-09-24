const traversalPattern = /(?:^|\/)(?:\.\.|%2e%2e)(?:\/|$)/i

export class SourcePolicy {
  private readonly hosts: Set<string>

  constructor(hosts: string[]) {
    this.hosts = new Set(hosts.map((host) => host.toLowerCase()))
  }

  assertAllowedUrl(value: string, documentBaseUrl?: string): URL {
    if (traversalPattern.test(value)) {
      throw new Error('URL path traversal is not allowed')
    }

    const url = new URL(value)
    if (url.protocol !== 'https:') {
      throw new Error('Only HTTPS source URLs are allowed')
    }
    if (!this.hosts.has(url.hostname.toLowerCase())) {
      throw new Error(`Source host is not allowed: ${url.hostname}`)
    }

    if (documentBaseUrl) {
      const base = this.assertAllowedUrl(documentBaseUrl)
      const directory = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)
      if (url.hostname !== base.hostname || !url.pathname.startsWith(directory)) {
        throw new Error('Asset URL is outside the document directory')
      }
    }

    return url
  }
}
