import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { extractDocumentBytes, extractDocumentVersion, mergeExtractionMetadata } from '../../src/modules/documents/application/extract-document'
import { documentSourceClassification } from '../../src/modules/operations/executors'

describe('independent extraction retains archived provenance',()=>{
  it('extracts canonical Tariff JSON without trusting source claims inside the bytes',async()=>{
    const bytes=Buffer.from(JSON.stringify({code:'1001',date:'2026-10-11',measures:[{label:'Örnek önlem'}],classification:'VERIFIED_OFFICIAL'}))
    const metadata={classification:'SUPPORTING_NON_AUTHORITATIVE',queryDate:'2026-10-11',sourceUrl:'https://tariff.singlewindow.io/',code:'1001',sections:[{reference:'old',text:'stale'}],error:'Previous transient error'}
    const version={id:'tariff-v',mimeType:'application/json',storedObject:{objectKey:'tariff-blob'},extractionMetadata:metadata}
    const update=vi.fn(async()=>version)
    const prisma={documentVersion:{findFirst:vi.fn(async()=>version),update}} as unknown as PrismaClient
    const result=await extractDocumentVersion({prisma,objectStore:{getContent:vi.fn(async()=>bytes)}},'tariff-v','local-workspace')
    expect(result.status).toBe('READY');expect(JSON.parse(result.text!)).toMatchObject({code:'1001',classification:'VERIFIED_OFFICIAL'})
    expect(result.metadata).toMatchObject({classification:'SUPPORTING_NON_AUTHORITATIVE',queryDate:'2026-10-11',sourceUrl:'https://tariff.singlewindow.io/',sections:[{reference:'json'}]})
    expect(result.metadata.error).toBeUndefined();expect(result.metadata.sections[0]?.text).not.toBe('stale')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({extractionStatus:'READY',extractionMetadata:result.metadata})}))
    expect(documentSourceClassification({document:{origin:'SOURCE',canonicalUrl:'https://tariff.singlewindow.io/'},extractionMetadata:result.metadata})).toBe('SUPPORTING_NON_AUTHORITATIVE')
  })
  it('retains verified source identity and relationship even when extracting fails',async()=>{
    const metadata={classification:'VERIFIED_OFFICIAL',sourceKey:'resmi-gazete',sourceUrl:'https://www.resmigazete.gov.tr/file.pdf',verification:'OFFICIAL_SEARCH_MATCH_AND_CAPTURE',relationship:'PREVIOUS',primaryInputDocumentVersionId:'primary-version',assetRole:'DOCUMENT'}
    const version={id:'previous-v',mimeType:'application/json',storedObject:{objectKey:'bad-blob'},extractionMetadata:metadata}
    const prisma={documentVersion:{findFirst:vi.fn(async()=>version),update:vi.fn()}} as unknown as PrismaClient
    const result=await extractDocumentVersion({prisma,objectStore:{getContent:vi.fn(async()=>Buffer.from('{broken json'))}},'previous-v','local-workspace')
    expect(result).toMatchObject({status:'FAILED',text:null,metadata:{...metadata,sections:[],error:'Arşivlenmiş JSON belgesi geçerli değil.'}})
    expect(documentSourceClassification({document:{origin:'SOURCE',canonicalUrl:metadata.sourceUrl},extractionMetadata:result.metadata})).toBe('VERIFIED_OFFICIAL')
  })
  it('rejects oversized rendered JSON instead of silently losing evidence',async()=>{
    await expect(extractDocumentBytes(Buffer.from(JSON.stringify({text:'a'.repeat(1_000_001)})),'application/json')).rejects.toThrow('sınırı')
    expect(mergeExtractionMetadata(null,{sections:[]})).toEqual({sections:[]})
    expect(mergeExtractionMetadata(['untrusted shape'],{sections:[]})).toEqual({sections:[]})
  })
})
