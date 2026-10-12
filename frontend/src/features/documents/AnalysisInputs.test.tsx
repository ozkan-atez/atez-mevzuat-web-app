import { cleanup, render, screen } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalysisInputs, resolveDocumentRoles } from './AnalysisInputs'
afterEach(cleanup)
const documents=[{id:'first',title:'Yeni düzenleme'},{id:'second',title:'Önceki düzenleme'}]
describe('analysis input roles',()=>{
  it('defaults one primary and keeps versions explicit',()=>{
    expect(resolveDocumentRoles(documents,{})).toEqual({first:'PRIMARY',second:'SUPPORTING'})
    expect(resolveDocumentRoles(documents,{first:'PRIMARY',second:'PRIMARY'})).toEqual({first:'PRIMARY',second:'SUPPORTING'})
  })
  it('assigns one new primary and attaches successful evidence tasks',async()=>{
    const onRolesChange=vi.fn(),onEvidenceChange=vi.fn()
    render(<AnalysisInputs documents={documents} roles={{first:'PRIMARY',second:'PREVIOUS'}} onRolesChange={onRolesChange} evidenceTaskIds={[]} onEvidenceChange={onEvidenceChange} evidenceTasks={[{id:'tariff-task',operation:'TARIFF_LOOKUP',status:'SUCCEEDED',reused:false,artifacts:[]},{id:'failed',operation:'PREVIOUS_SOURCES',status:'FAILED',reused:false,artifacts:[]}]} />)
    await userEvent.click(screen.getByLabelText('Önceki düzenleme belgesinin rolü'))
    await userEvent.click((await screen.findAllByText('Ana belge')).at(-1)!)
    expect(onRolesChange).toHaveBeenCalledWith({first:'SUPPORTING',second:'PRIMARY'})
    await userEvent.click(screen.getByRole('checkbox',{name:'Tarife sonucu 1'}))
    expect(onEvidenceChange).toHaveBeenCalledWith(['tariff-task'])
    expect(screen.queryByText('Önceki kaynak sonucu 2')).not.toBeInTheDocument()
  })
})
