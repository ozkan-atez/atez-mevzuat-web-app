import { describe,it,expect,vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { OperationService,operationHash,OperationInputSchema } from '../../src/modules/operations/operation-service'
import { createOperationExecutors,validateStandaloneEvidence,StandaloneAnalysisSchema,documentSourceClassification } from '../../src/modules/operations/executors'
const version = {id:'v1',contentHash:'hash',extractorVersion:'extractor1',extractionStatus:'READY',extractedText:'Kaynak belge metni.',document:{actorScope:'local-workspace',title:'Kaynak',origin:'UPLOAD',publishedOn:null,canonicalUrl:null},fetchedAt:new Date()}
const fake = (status='READY') => ({documentVersion:{findMany:vi.fn().mockResolvedValue([{...version,extractionStatus:status}])},operationTask:{findFirst:vi.fn().mockResolvedValue(null)},operationRequest:{findUnique:vi.fn().mockResolvedValue(null)}})
const result = () => StandaloneAnalysisSchema.parse({schemaVersion:2,title:'Başlık',summary:'Özet',detailedAnalysis:'Açıklama',changes:[{description:'Değişiklik',evidenceIds:['e1']}],affectedParties:[],effectiveDates:[],unresolvedReferences:[],evidence:[{id:'e1',documentVersionId:'v1',excerpt:'Kaynak belge'}]})
describe('modular operation planning',()=>{
 it('hashes sorted object keys without changing ordered semantic input',()=>{expect(operationHash({b:2,a:1})).toBe(operationHash({a:1,b:2}));expect(operationHash([1,2])).not.toBe(operationHash([2,1]))})
 it('defaults read requests to REUSE_ONLY',()=>expect(OperationInputSchema.parse({operation:'ANALYZE'}).mode).toBe('REUSE_ONLY'))
 it('reports absent result instead of triggering executor in REUSE_ONLY',async()=>{const exec=vi.fn();const db=fake();const service=new OperationService(db as unknown as PrismaClient,{executors:{ANALYZE:exec}});const plan=await service.plan({operation:'ANALYZE',documentVersionIds:['v1']});expect(plan.canStart).toBe(false);expect(plan.missing).toContainEqual({operation:'ANALYZE',reason:'RESULT_MISSING'});expect(exec).not.toHaveBeenCalled()})
 it('adds only extraction prerequisite for unread documents under FILL_MISSING',async()=>{const db=fake('PENDING');const service=new OperationService(db as unknown as PrismaClient,{executors:{ANALYZE:vi.fn(),EXTRACT:vi.fn()}});const plan=await service.plan({operation:'ANALYZE',mode:'FILL_MISSING',documentVersionIds:['v1']});expect(plan.canStart).toBe(true);expect(plan.tasks.map(t=>t.operation)).toEqual(['EXTRACT','ANALYZE']);expect(plan.tasks[1]!.signatureDependencies).toEqual([plan.tasks[0]!.inputSignature])})
 it('does not claim image OCR is available',async()=>{const service=new OperationService(fake('OCR_REQUIRED') as unknown as PrismaClient,{executors:{ANALYZE:vi.fn(),EXTRACT:vi.fn()}});const plan=await service.plan({operation:'ANALYZE',mode:'FILL_MISSING',documentVersionIds:['v1']});expect(plan.canStart).toBe(false);expect(plan.missing[0]!.reason).toBe('OCR_REQUIRED')})
 it('reuses already extracted text without a network or AI executor',async()=>{const service=new OperationService(fake() as unknown as PrismaClient);const plan=await service.plan({operation:'EXTRACT',documentVersionIds:['v1']});expect(plan.canStart).toBe(true);expect(plan.tasks[0]!.reused).toBe(true)})
 it('does not disclose versions outside the server scope',async()=>{const db=fake();db.documentVersion.findMany.mockResolvedValue([]);const service=new OperationService(db as unknown as PrismaClient);await expect(service.plan({operation:'EXTRACT',documentVersionIds:['hidden']})).rejects.toMatchObject({statusCode:404});expect(db.documentVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['hidden']},document:{actorScope:'local-workspace'}}}))})
 it('rejects key reuse with a different semantic request',async()=>{const db=fake();db.operationRequest.findUnique.mockResolvedValue({payloadHash:'different'});const service=new OperationService(db as unknown as PrismaClient);await expect(service.start({operation:'EXTRACT',documentVersionIds:['v1']},'same')).rejects.toMatchObject({statusCode:409})})
 it('changes cache keys when analysis instructions differ',async()=>{const service=new OperationService(fake() as unknown as PrismaClient,{executors:{ANALYZE:vi.fn()}});const a=await service.plan({operation:'ANALYZE',mode:'FORCE',documentVersionIds:['v1'],instruction:'A'});const b=await service.plan({operation:'ANALYZE',mode:'FORCE',documentVersionIds:['v1'],instruction:'B'});expect(a.tasks[0]!.inputSignature).not.toBe(b.tasks[0]!.inputSignature)})
})
describe('independent analysis evidence',()=>{
 it('accepts only exact quotations from selected versions',()=>{expect(()=>validateStandaloneEvidence(result(),[version])).not.toThrow();const forged=result();forged.evidence[0]!.excerpt='Uydurma alıntı';expect(()=>validateStandaloneEvidence(forged,[version])).toThrow('Kanıt alıntısı')})
 it('rejects unsupported reference IDs',()=>{const invalid=result();invalid.changes[0]!.evidenceIds=['absent'];expect(()=>validateStandaloneEvidence(invalid,[version])).toThrow('Tanımsız kanıt')})
 it('uploads no documents to AI during EXTRACT and blocks OCR result',async()=>{const ai={generateStructured:vi.fn()},extract=vi.fn().mockResolvedValue({status:'OCR_REQUIRED'});const db={documentVersion:{findFirst:vi.fn().mockResolvedValue({...version,extractionStatus:'OCR_REQUIRED',extractedText:null})}};const executors=createOperationExecutors({prisma:db as unknown as PrismaClient,objectStore:{} as any,aiModel:ai,model:'fake',extract});await expect(executors.EXTRACT!({operation:'EXTRACT',mode:'FORCE',documentVersionIds:['v1']},{taskId:'t',actorScope:'local-workspace',signal:new AbortController().signal})).rejects.toMatchObject({category:'OCR_REQUIRED'});expect(ai.generateStructured).not.toHaveBeenCalled()})
})

describe('analysis roles, conflict evidence and composition',()=>{
 it('assigns a deterministic primary and preserves explicit previous-document roles',async()=>{
  const db=fake();db.documentVersion.findMany.mockResolvedValue([version,{...version,id:'v2',contentHash:'other'}]);const service=new OperationService(db as unknown as PrismaClient,{executors:{ANALYZE:vi.fn()}})
  const plan=await service.plan({operation:'ANALYZE',mode:'FORCE',documentVersionIds:['v1','v2'],documentRoles:{v2:'PREVIOUS'}})
  expect(plan.tasks[0]!.parameters.documentRoles).toEqual({v1:'PRIMARY',v2:'PREVIOUS'})
 })
 it('rejects two primary documents and roles for an unselected version',async()=>{
  const service=new OperationService(fake() as unknown as PrismaClient,{executors:{ANALYZE:vi.fn()}})
  await expect(service.plan({operation:'ANALYZE',documentVersionIds:['v1','v2'],documentRoles:{v1:'PRIMARY',v2:'PRIMARY'}})).rejects.toThrow('tek bir ana belge')
  await expect(service.plan({operation:'ANALYZE',documentVersionIds:['v1'],documentRoles:{hidden:'PREVIOUS'}})).rejects.toThrow('seçilen sürümlere')
 })
 it('composes scoped previous-source results into an extraction prerequisite and analysis without another search',async()=>{
  const db=fake() as any;db.documentVersion.findMany.mockResolvedValue([version,{...version,id:'previous',extractedText:null,extractionStatus:'PENDING'}]);db.operationTask.findMany=vi.fn().mockResolvedValue([{id:'prior-task',operation:'PREVIOUS_SOURCES',inputSignature:'prior-key',artifacts:[{id:'prior-artifact',kind:'DOCUMENT_VERSION',referenceId:'previous'}]}])
  const analyze=vi.fn(),extract=vi.fn(),service=new OperationService(db as PrismaClient,{executors:{ANALYZE:analyze,EXTRACT:extract}})
  const plan=await service.plan({operation:'ANALYZE',mode:'FILL_MISSING',documentVersionIds:['v1'],evidenceTaskIds:['prior-task']})
  expect(plan.tasks.map(t=>t.operation)).toEqual(['EXTRACT','ANALYZE']);expect(plan.tasks[1]!.parameters.documentVersionIds).toEqual(['v1','previous']);expect(plan.tasks[1]!.parameters.documentRoles).toEqual({v1:'PRIMARY',previous:'PREVIOUS'});expect(analyze).not.toHaveBeenCalled();expect(extract).not.toHaveBeenCalled();expect(db.operationTask.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:{in:['prior-task']},actorScope:'local-workspace',status:'SUCCEEDED'}}))
 })
 it('rejects arbitrary uploaded evidence being labelled as a trusted Tariff query',async()=>{
  const db=fake();db.documentVersion.findMany.mockResolvedValue([version,{...version,id:'other'}]);const service=new OperationService(db as unknown as PrismaClient,{executors:{ANALYZE:vi.fn()}})
  await expect(service.plan({operation:'ANALYZE',mode:'FORCE',documentVersionIds:['v1','other'],documentRoles:{v1:'PRIMARY',other:'TARIFF'}})).rejects.toThrow('kayıtlı Tariff kanıtı')
 })
 it('validates cross-document conflicts against quoted evidence from both documents',()=>{
  const data=result();data.evidence.push({id:'e2',documentVersionId:'v2',excerpt:'Önceki metin'});data.conflicts=[{description:'İki hüküm uyuşmuyor.',documentVersionIds:['v1','v2'],evidenceIds:['e1','e2'],resolution:'UNRESOLVED'}]
  expect(()=>validateStandaloneEvidence(data,[version,{id:'v2',extractedText:'Önceki metin başka hüküm.'}])).not.toThrow()
  data.conflicts[0]!.evidenceIds=['e1','e1'];expect(()=>validateStandaloneEvidence(data,[version,{id:'v2',extractedText:'Önceki metin başka hüküm.'}])).toThrow('en az iki seçili belgeden')
 })
 it('does not accept client-authored execution snapshots',()=>expect(()=>OperationInputSchema.parse({operation:'DISCOVER',executionSnapshot:{source:{baseUrl:'https://attacker.test'}}})).toThrow())
 it('locates actual quoted text server-side rather than trusting model-supplied offsets',async()=>{
  const data=result();data.evidence[0]!.locator={reference:'forged-page',characterStart:999,characterEnd:1000}
  const db={documentVersion:{findMany:vi.fn().mockResolvedValue([{...version,extractionMetadata:{sections:[{reference:'page:1',text:version.extractedText}]}}])}}
  const executors=createOperationExecutors({prisma:db as unknown as PrismaClient,objectStore:{} as any,aiModel:{generateStructured:vi.fn().mockResolvedValue({json:data,providerRequestId:null,usage:{}})},model:'fake',extract:vi.fn()})
  const output=await executors.ANALYZE!({operation:'ANALYZE',mode:'FORCE',documentVersionIds:['v1'],documentRoles:{v1:'PRIMARY'}},{taskId:'task',actorScope:'local-workspace',signal:new AbortController().signal})
  expect((output[0]!.data as any).evidence[0].locator).toEqual({reference:'page:1',characterStart:0,characterEnd:'Kaynak belge'.length});expect((output[0]!.data as any).sourceContext[0].role).toBe('PRIMARY')
 })
})


describe('verified provenance boundaries',()=>{
 const official={classification:'VERIFIED_OFFICIAL',sourceKey:'resmi-gazete',sourceUrl:'https://www.resmigazete.gov.tr/a.pdf',verification:'OFFICIAL_SEARCH_MATCH_AND_CAPTURE'}
 it('labels only verified archived official source bytes as official',()=>expect(documentSourceClassification({document:{origin:'SOURCE',canonicalUrl:official.sourceUrl},extractionMetadata:official})).toBe('VERIFIED_OFFICIAL'))
 it('never elevates an uploaded file even when it cites an official URL',()=>expect(documentSourceClassification({document:{origin:'UPLOAD',canonicalUrl:official.sourceUrl},extractionMetadata:official})).toBe('USER_PROVIDED'))
 it('keeps forged metadata, off-domain and non-HTTPS sources unverified',()=>{
  expect(documentSourceClassification({document:{origin:'SOURCE',canonicalUrl:'https://attacker.test/a.pdf'},extractionMetadata:{...official,sourceUrl:'https://attacker.test/a.pdf'}})).toBe('SOURCE_UNVERIFIED')
  expect(documentSourceClassification({document:{origin:'SOURCE',canonicalUrl:official.sourceUrl},extractionMetadata:{...official,verification:'MODEL_SAID_SO'}})).toBe('SOURCE_UNVERIFIED')
 })
 it('keeps genuine Tariff evidence supporting and never labels it official',()=>{
  const url='https://tariff.singlewindow.io/api/query'
  expect(documentSourceClassification({document:{origin:'SOURCE',canonicalUrl:url},extractionMetadata:{classification:'SUPPORTING_NON_AUTHORITATIVE',sourceUrl:url}})).toBe('SUPPORTING_NON_AUTHORITATIVE')
 })
})
