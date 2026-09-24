import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadedFile } from '../../src/modules/scan-runs/application/ports'

export async function fixtureFile(body: string | Buffer, mediaType: string): Promise<DownloadedFile> {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const directory = await mkdtemp(join(tmpdir(), 'atez-test-'))
  const tempPath = join(directory, 'download')
  await writeFile(tempPath, bytes)
  return {
    tempPath,
    mediaType,
    byteSize: BigInt(bytes.byteLength),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceUrl: 'https://www.resmigazete.gov.tr/test',
  }
}
