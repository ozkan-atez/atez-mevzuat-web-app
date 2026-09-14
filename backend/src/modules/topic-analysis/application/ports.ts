import type { AiInputPart } from '../../ai/application/ai-model-client'

export interface TopicStoredObject {
  objectKey: string
  sha256: string
  mediaType: string
  byteSize: bigint
}

export interface TopicEvidenceAsset {
  id: string
  sourceUrl: string
  role: 'ATTACHMENT' | 'IMAGE' | 'STYLESHEET_ASSET' | 'OTHER_SUPPORTED'
  object: TopicStoredObject
}

export interface TopicEvidenceInput {
  topicId: string
  runId: string
  targetDate: string
  document: {
    title: string
    sourceUrl: string
    object: TopicStoredObject
    assets: TopicEvidenceAsset[]
  }
  previousSource: null | {
    title: string
    sourceUrl: string
    object: TopicStoredObject
    assets: TopicEvidenceAsset[]
  }
}

export interface TopicObjectStore {
  getContent(key: string): Promise<Buffer>
  putRunFile(key: string, body: Buffer, mediaType: string): Promise<{
    objectKey: string
    sha256: string
    mediaType: string
    byteSize: bigint
  }>
}

export interface EvidencePart {
  topicId: string
  sourceId: string
  title: string
  sourceUrl: string
  objectKey: string
  sha256: string
  mediaType: string
  byteSize: string
}

export interface EvidenceContext {
  topicId: string
  signature: string
  parts: EvidencePart[]
  aiParts: AiInputPart[]
  manifest: Buffer
}
