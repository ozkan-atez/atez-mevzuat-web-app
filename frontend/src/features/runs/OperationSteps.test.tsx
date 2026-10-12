import { cleanup, render, screen } from '../../test/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationSteps } from './OperationSteps'
import type { ScanRunDetail } from '../scans/types'
afterEach(cleanup)
const run: ScanRunDetail = { id: 'run', targetDate: '2026-10-11', currentStage: null, startedAt: null, completedAt: null, errorSummary: null, filter: null, previousSources: null, counts: { editions: 0, documents: 2, assets: 0, completedItems: 2, totalItems: 2, failedItems: 0 }, sourceKeys: ['ticaret-bakanligi', 'tariff'], status: 'PARTIAL', stages: [], editions: [], sourceRuns: [{ id: 'source1', source: { key: 'ticaret-bakanligi', name: 'Ticaret Bakanlığı' }, status: 'PARTIAL', documentCount: 0, errorSummary: 'Tarihsiz PDF' }, { id: 'source2', source: { key: 'tariff', name: 'TARIFF' }, status: 'COMPLETED', documentCount: 2, errorSummary: null }] }
function show(value: ScanRunDetail) { render(<MemoryRouter><OperationSteps run={value} onRetryAiFilter={vi.fn()} onRetryPreviousSources={vi.fn()} isRetrying={false} retryError={null} /></MemoryRouter>) }
describe('source-aware operations', () => {
  it('shows real source statuses without a fictitious Gazette workflow', () => {
    show(run)
    expect(screen.queryByText('Resmî Gazete yayınları bulunuyor')).not.toBeInTheDocument()
    expect(screen.getByText('Kısmen tamamlandı')).toBeVisible()
    expect(screen.getByText('Tamamlandı')).toBeVisible()
    expect(screen.getByText('Tarihsiz PDF')).toBeVisible()
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/source-runs/source1')
  })
  it('explains skipped AI steps and keeps selection notes visible without an error',()=>{
    show({...run,status:'COMPLETED',sourceKeys:['ticaret-bakanligi'],sourceRuns:[{...run.sourceRuns![0]!,status:'COMPLETED',errorSummary:null,notes:['Tarihsiz kayıt envanterde tutuldu.'],stages:[{stage:'FILTER',status:'SKIPPED',totalItems:0,completedItems:0,error:null}]}]})
    expect(screen.getByText('Belge yok · gerekmedi')).toBeVisible()
    expect(screen.getByText('Tarihsiz kayıt envanterde tutuldu.')).toBeVisible()
    expect(screen.queryByText('Kısmen tamamlandı')).not.toBeInTheDocument()
  })
  it('keeps the Gazette stages when Gazette is explicitly selected alongside other sources', () => {
    show({ ...run, sourceKeys: ['resmi-gazete', 'ticaret-bakanligi', 'tariff'] })
    expect(screen.getByText('Resmî Gazete yayınları bulunuyor')).toBeVisible()
    expect(screen.getByText('Ticaret Bakanlığı')).toBeVisible()
  })
})
