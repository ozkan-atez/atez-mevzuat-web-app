import { describe, expect, it } from 'vitest'
import { S3ObjectStore, StorageKeys, sha256 } from '../src/index'

describe('MinIO ObjectStore', () => {
  it('içerik adresli yazar ve okur', async () => {
    const store = new S3ObjectStore({
      endpoint: process.env.TEST_S3_ENDPOINT!,
      region: 'eu-central-1',
      bucket: process.env.TEST_S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: true,
    })
    await store.ensureBucket()
    const body = Buffer.from(`merhaba ${Date.now()}`)
    const key = StorageKeys.documentFile(sha256(body), 'txt')
    await store.put(key, body, 'text/plain')
    expect(await store.exists(key)).toBe(true)
    expect((await store.get(key)).toString()).toBe(body.toString())
    expect(await store.exists(StorageKeys.documentFile('0'.repeat(64), 'txt'))).toBe(false)
    store.destroy()
  })
})
