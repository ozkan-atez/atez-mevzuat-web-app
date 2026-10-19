import {it,expect,vi} from 'vitest'
import {executeScanRun} from '../../src/modules/scan-runs/application/execute-scan-run'
vi.mock('../../src/modules/scan-runs/application/build-manifest',()=>({buildManifest:()=>Buffer.from('{}')}))
it('completes an archived automation discovery without AI, downloads or a new report',async()=>{
 const repository={
  getExecutionRun:vi.fn(async()=>({id:'r',status:'PARTIAL',targetDate:'2026-10-19',downloadedBytes:100n,indexObjectKey:'index',indexSourceUrl:'https://www.resmigazete.gov.tr/19.10.2026'})),
  startRun:vi.fn(),startStage:vi.fn(),advanceStage:vi.fn(),completeStage:vi.fn(),
  saveEditions:vi.fn(async()=>({discovered:1,skipped:1})),skipPreviouslyProcessedStages:vi.fn(),
  completedSnapshot:vi.fn(async()=>({})),verifyManifestCounts:vi.fn(),completeRun:vi.fn(),failStage:vi.fn(),failRun:vi.fn(),
 }
 const http={download:vi.fn()},aiModel={generateStructured:vi.fn()}
 const objectStore={ensureBucket:vi.fn(),getContent:vi.fn(async()=>Buffer.from('<a href="/eskiler/2026/10/20261019-1.htm">Belge</a>')),putRunFile:vi.fn(async()=>({objectKey:'manifest'}))}
 await executeScanRun('r',{repository,http,objectStore,aiModel,maxRunBytes:1000n} as any)
 expect(repository.skipPreviouslyProcessedStages).toHaveBeenCalledWith('r')
 expect(repository.completeRun).toHaveBeenCalledWith('r','manifest')
 expect(repository.failRun).not.toHaveBeenCalled()
 expect(aiModel.generateStructured).not.toHaveBeenCalled()
 expect(http.download).not.toHaveBeenCalled()
})
