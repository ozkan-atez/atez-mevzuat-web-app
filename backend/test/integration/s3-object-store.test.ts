import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { beforeAll, describe, expect, it } from 'vitest'
import { S3ObjectStore } from '../../src/modules/scan-runs/infrastructure/s3-object-store'
import { fixtureFile } from '../helpers/files'

const config = {
  endpoint: 'http://localhost:59000',
  region: 'eu-central-1',
  bucket: 'resmi-gazete-test',
  accessKeyId: 'atez-local-access',
  secretAccessKey: 'atez-local-secret-change-me',
  forcePathStyle: true,
}
const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
})
const store = new S3ObjectStore(config)

describe('S3ObjectStore', () => {
  beforeAll(() => store.ensureBucket())

  it('stores equal bytes at one content-addressed key', async () => {
    const file = await fixtureFile('%PDF-1.7\nfixture', 'application/pdf')
    const first = await store.putContent(file)
    const second = await store.putContent(file)
    const response = await client.send(new ListObjectsV2Command({ Bucket: first.bucket, Prefix: first.objectKey }))

    expect(second.objectKey).toBe(first.objectKey)
    expect(first.objectKey).toMatch(/^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/)
    expect(response.KeyCount).toBe(1)
  })
})
