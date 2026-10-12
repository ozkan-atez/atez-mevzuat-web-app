export function sourceArtifactIsComplete(operation: string, artifacts: Array<{kind: string; data?: unknown}>): boolean {
  const object = (data: unknown): Record<string, unknown> => data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  if (operation === 'DISCOVER') return artifacts.some(artifact => artifact.kind === 'DISCOVERY' && object(artifact.data).coverage === 'COMPLETE')
  if (operation === 'CAPTURE') {
    const capture = artifacts.find(artifact => artifact.kind === 'CAPTURE')
    if (capture) return artifacts.some(artifact=>artifact.kind==='CAPTURE' && object(artifact.data).status==='COMPLETED')
    return artifacts.some(artifact => artifact.kind === 'DOCUMENT_VERSION')
  }
  return true
}
