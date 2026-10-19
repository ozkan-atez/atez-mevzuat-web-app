import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

export interface ObjectStore {
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
}

export interface S3Options {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client
  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    })
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.opts.bucket }))
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.opts.bucket }))
    }
  }

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: contentType }))
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }))
      return true
    } catch (err) {
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false
      throw err
    }
  }

  destroy(): void {
    this.client.destroy()
  }
}

/** Testler için bellek içi depo. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()
  async put(key: string, body: Uint8Array | string, contentType: string) {
    this.objects.set(key, { body: Buffer.from(body), contentType })
  }
  async get(key: string) {
    const o = this.objects.get(key)
    if (!o) throw new Error(`NoSuchKey: ${key}`)
    return o.body
  }
  async exists(key: string) {
    return this.objects.has(key)
  }
}
