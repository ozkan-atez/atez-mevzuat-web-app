import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesPage } from './SourcesPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('SourcesPage', () => {
  it('shows source sites separately from approved evidence pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('source-sites')
      ? { sites: [
        { id: 'igmd', key: 'igmd', name: 'İGMD', baseUrl: 'https://www.igmd.org.tr/', authorityType: 'PROFESSIONAL', isActive: true, endpoints: [] },
        { id: 'tariff', key: 'tariff', name: 'TARIFF', baseUrl: 'https://tariff.singlewindow.io/', authorityType: 'COMMERCIAL', isActive: true, endpoints: [] },
      ] }
      : { sources: [] }))))
    render(<SourcesPage />)

    expect(await screen.findByRole('region', { name: 'Kaynak keşfi' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'İGMD' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'TARIFF' })).toBeVisible()
    expect(screen.getByText('Öneriler onaylanana kadar sohbet ve taramada kullanılmaz.')).toBeVisible()
  })

  it('adds a link with separate chat and run controls', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(_url).includes('source-sites')) return new Response(JSON.stringify({ sites: [] }))
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ sources: [] }))
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      requests.push(body)
      return new Response(JSON.stringify({ id: 'source-1', ...body, contentText: 'Kaynak metni', contentType: 'text/html', fetchError: null, fetchedAt: new Date().toISOString(), createdAt: '', updatedAt: '' }), { status: 201 })
    }))
    const user = userEvent.setup()
    render(<SourcesPage />)
    await user.type(screen.getByRole('textbox', { name: 'Kaynak bağlantısı' }), 'https://example.org/guide')
    await user.type(screen.getByRole('textbox', { name: 'Kaynak adı' }), 'Gümrük rehberi')
    await user.click(screen.getByRole('checkbox', { name: 'Taramalarda kullan' }))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ url: 'https://example.org/guide', title: 'Gümrük rehberi', useInChat: true, useInRuns: false })
    expect(await screen.findByText('Kaynak metni')).toBeInTheDocument()
  })
})
