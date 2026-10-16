import {describe,it,expect,vi,beforeEach} from 'vitest'
vi.mock('../../src/platform/rabbitmq',()=>({connectorQueueName:'atez-connector-setup'}))
vi.mock('../../src/modules/managed-sources/source-session',()=>({openSourceSession:vi.fn()}))
vi.mock('../../src/modules/managed-sources/source-secrets',()=>({sourceLogin:vi.fn(async()=>null)}))
vi.mock('../../src/modules/managed-sources/source-collector',()=>({collectSource:vi.fn()}))
import {openSourceSession} from '../../src/modules/managed-sources/source-session'
import {collectSource} from '../../src/modules/managed-sources/source-collector'
import {builtinProfile} from '../../src/modules/managed-sources/source-profile'
import {dispatchConnectorTests,executeConnectorTest,queueConnectorTest} from '../../src/modules/managed-sources/connector-setup'
const session={html:vi.fn(),binary:vi.fn(),close:vi.fn()}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(openSourceSession).mockResolvedValue(session)})
function db(status='SETUP_QUEUED') {return {sourceProfile:{findUniqueOrThrow:vi.fn(async()=>({id:'p',status,sourceId:'s',config:builtinProfile('igmd'),source:{id:'s',key:'igmd'}})),update:vi.fn()}}}
describe('connector setup',()=>{
 it('does not treat bounded sampling as a failed full scan',async()=>{
  const prisma=db();vi.mocked(collectSource).mockResolvedValue({items:[{title:'Test',url:'https://igmd.org.tr/doc',publishedOn:null} as any],warnings:['Belge sınırına ulaşıldı; kaynak bütünüyle taranamadı.'],pages:[],observed:4,oldestDate:null,newestDate:null})
  session.binary.mockResolvedValue({body:Buffer.from('%PDF-1.7'),contentType:'application/pdf'})
  await executeConnectorTest(prisma as any,'p')
  expect(prisma.sourceProfile.update).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:'VERIFIED'})}))
  expect(session.close).toHaveBeenCalled()
 })
 it('rejects a login page returned as a document and routes failure for manual attention',async()=>{
  const prisma=db();vi.mocked(collectSource).mockResolvedValue({items:[{title:'Test',url:'https://igmd.org.tr/doc'} as any],warnings:[],pages:[],observed:1,oldestDate:null,newestDate:null})
  session.binary.mockResolvedValue({body:Buffer.from('<input type="password">'),contentType:'text/html'})
  await expect(executeConnectorTest(prisma as any,'p')).rejects.toMatchObject({code:'CONNECTOR_SETUP_FAILED',retryable:false})
  expect(prisma.sourceProfile.update).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({status:'NEEDS_REVIEW'})}))
 })
 it('does not run a completed delivery twice',async()=>{await executeConnectorTest(db('VERIFIED') as any,'p');expect(openSourceSession).not.toHaveBeenCalled()})
 it('reuses a pending setup for concurrent test requests',async()=>{const row={id:'p',status:'SETUP_RUNNING'};const tx={$queryRaw:vi.fn(),sourceProfile:{findFirst:vi.fn(async()=>row)}};const prisma={$transaction:async(fn:any)=>fn(tx)};expect(await queueConnectorTest(prisma as any,'s')).toBe(row)})
 it('leaves queued records for retry when the broker is unavailable',async()=>{
  const updateMany=vi.fn();const prisma={sourceProfile:{findMany:vi.fn(async()=>[{id:'p',validation:{}}]),updateMany}}
  await expect(dispatchConnectorTests(prisma as any,{send:vi.fn(async()=>{throw new Error('offline')})})).rejects.toThrow('offline')
  expect(updateMany).not.toHaveBeenCalled()
 })
})
