import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { DownloadedFile, ObjectStore, StoredBlob } from '../application/ports'

interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

const extensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/html': 'html',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'application/json': 'json',
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    })
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }))
    } catch (error) {
      if (!isMissing(error)) throw error
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }))
    }
  }

  async putContent(file: DownloadedFile): Promise<StoredBlob> {
    const extension = extensions[file.mediaType] ?? 'bin'
    const objectKey = `objects/sha256/${file.sha256.slice(0, 2)}/${file.sha256.slice(2, 4)}/${file.sha256}.${extension}`
    if (await this.exists(objectKey)) {
      return { ...file, bucket: this.config.bucket, objectKey }
    }

    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      Body: createReadStream(file.tempPath),
      ContentLength: Number(file.byteSize),
      ContentType: file.mediaType,
      ChecksumSHA256: Buffer.from(file.sha256, 'hex').toString('base64'),
    }))
    return {
      ...file,
      bucket: this.config.bucket,
      objectKey,
      ...(response.VersionId ? { versionId: response.VersionId } : {}),
    }
  }

  async putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob> {
    const sha256 = createHash('sha256').update(body).digest('hex')
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: mediaType,
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
    }))
    return {
      sha256,
      bucket: this.config.bucket,
      objectKey: key,
      mediaType,
      byteSize: BigInt(body.byteLength),
      ...(response.VersionId ? { versionId: response.VersionId } : {}),
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  async getContent(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }))
    if (!response.Body) throw new Error(`Stored object has no body: ${key}`)
    return Buffer.from(await response.Body.transformToByteArray())
  }
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return value.name === 'NotFound' || value.name === 'NoSuchKey' || value.$metadata?.httpStatusCode === 404
}
