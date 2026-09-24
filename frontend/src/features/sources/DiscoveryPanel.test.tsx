import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiscoveryPanel } from './DiscoveryPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('source discovery', () => {
  it('discovers candidate links immediately after a site is added', async () => {
    const site = { id: 'site-1', key: 'custom-example', name: 'Örnek site', baseUrl: 'https://example.org/', authorityType: 'UNVERIFIED', isActive: true, endpoints: [] }
    let added = false
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST' && path.endsWith('/discover')) {
        return new Response(JSON.stringify({ examined: 3, suggested: 1, aiUsed: true, endpoints: [] }))
      }
      if (init?.method === 'POST') { added = true; return new Response(JSON.stringify(site), { status: 201 }) }
      return new Response(JSON.stringify({ sites: added ? [site] : [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<DiscoveryPanel onActivate={() => undefined} />)
    await user.type(screen.getByRole('textbox', { name: 'Yeni site adı' }), 'Örnek site')
    await user.type(screen.getByRole('textbox', { name: 'Yeni site adresi' }), 'https://example.org/')
    await user.click(screen.getByRole('button', { name: 'Site ekle' }))
    expect(await screen.findByText(/3 bağlantı incelendi, 1 öneri bulundu/)).toBeVisible()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/source-sites/site-1/discover', { method: 'POST' })
  })
})
