import { cleanup, render, screen } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublishDraftBar } from './PublishDraftBar'
afterEach(cleanup)
describe('explicit draft save',()=>{
  it('saves accumulated changes once only after explicit click',async()=>{
    const onPublish=vi.fn()
    render(<PublishDraftBar pendingCount={3} isBusy={false} conflictVersion={null} nextVersion={4} staleBehindVersion={null} onPublish={onPublish} onDiscard={()=>{}} onReload={()=>{}} />)
    expect(onPublish).not.toHaveBeenCalled()
    expect(screen.getByText(/3 değişiklik taslakta birikti/)).toBeVisible()
    await userEvent.click(screen.getByRole('button',{name:'Kaydet ve r04 oluştur'}))
    expect(onPublish).toHaveBeenCalledTimes(1)
  })
  it('blocks saving and discarding while a correction request is processing',()=>{
    render(<PublishDraftBar pendingCount={2} isBusy={false} isPrompting conflictVersion={null} nextVersion={3} staleBehindVersion={null} onPublish={()=>{}} onDiscard={()=>{}} onReload={()=>{}} />)
    expect(screen.getByRole('button',{name:'Kaydet ve r03 oluştur'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'Taslağı iptal et'})).toBeDisabled()
  })
})
