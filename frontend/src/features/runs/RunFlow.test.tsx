import {describe, expect, it} from 'vitest'
import {render, screen, within} from '../../test/test-utils'
import type {ScanRunDetail} from '../scans/types'
import {flowStatus, RunFlow} from './RunFlow'

describe('Grouped run flow',()=>{
  it('does not hide failed or missing steps behind completed steps',()=>{
    expect(flowStatus(['COMPLETED','FAILED'],true)).toBe('FAILED')
    expect(flowStatus(['COMPLETED','PENDING'],true)).toBe('UNKNOWN')
    expect(flowStatus(['COMPLETED','SKIPPED'],true)).toBe('COMPLETED')
    expect(flowStatus(['SKIPPED','SKIPPED'],true)).toBe('SKIPPED')
  })
  it('shows five unnumbered stages with actual source progress and errors',()=>{
    const run={status:'COMPLETED',sourceKeys:['igmd'],editions:[],stages:[],sourceRuns:[{
      id:'source-1',source:{key:'igmd',name:'İGMD'},status:'PARTIAL',documentCount:3,errorSummary:null,
      stages:[{stage:'CAPTURE',status:'FAILED',totalItems:3,completedItems:2,error:'Dosya indirilemedi.'},{stage:'VALIDATION',status:'COMPLETED',totalItems:2,completedItems:2,error:null}],
      notes:['2 belge önceki çalışmayla aynı; yeniden analiz edilmedi.'],
    }]} as unknown as ScanRunDetail
    render(<RunFlow run={run}/>)
    expect(screen.getAllByRole('heading',{level:3})).toHaveLength(5)
    const capture=screen.getByRole('region',{name:'Belge toplama'})
    expect(within(capture).getByText('Hata oluştu',{selector:'.run-flow-status'})).toBeVisible()
    expect(within(capture).getByText('Hata oluştu · 2 / 3 kayıt')).toBeVisible()
    expect(within(capture).getByText('Dosya indirilemedi.')).toBeInTheDocument()
    expect(screen.getByText('2 belge önceki çalışmayla aynı; yeniden analiz edilmedi.')).toBeInTheDocument()
    expect(screen.queryByText('1',{selector:'.run-flow-indicator'})).not.toBeInTheDocument()
  })
})
