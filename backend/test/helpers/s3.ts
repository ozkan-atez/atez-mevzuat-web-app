/**
 * Object-store tests need a real S3-compatible service (MinIO in CI).
 * They run only when S3_TEST_ENDPOINT is set, like RABBITMQ_TEST_URL for the broker.
 */
export const s3TestEnabled = Boolean(process.env.S3_TEST_ENDPOINT)

export const s3TestConfig = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? 'http://127.0.0.1:1',
  region: process.env.S3_TEST_REGION ?? 'eu-central-1',
  bucket: process.env.S3_TEST_BUCKET ?? 'resmi-gazete-test',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? '',
  forcePathStyle: true,
}
