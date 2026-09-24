import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DockedAiAssistant } from '../chat/DockedAiAssistant'
import { ActiveTemplateProvider } from './ActiveTemplateContext'
import { TemplatesPage } from './TemplatesPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('TemplatesPage', () => {
  it('adds a ready component and applies an AI draft without opening chat or saving', async () => {
    const baseHtml = '<html><body><main><!-- ATEZ_COMPONENTS --></main></body></html>'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/catalog')) return new Response(JSON.stringify({ baseHtml, components: [{ key: 'summary', name: 'Yönetici özeti', description: 'Özet kartı', html: '<section>Hazır özet</section>' }], presets: [{ key: 'executive', name: 'Yönetici bülteni', description: 'Özet', components: ['summary'] }] }), { status: 200 })
      if (url.endsWith('/suggest') && init?.method === 'POST') return new Response(JSON.stringify({ name: 'AI şablonu', description: null, html: '<html><body><main>AI tasarımı</main></body></html>', summary: 'Yerleşim güncellendi.' }), { status: 200 })
      return new Response(JSON.stringify({ templates: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter initialEntries={['/templates']}><ActiveTemplateProvider><Routes><Route path="/templates" element={<><TemplatesPage /><DockedAiAssistant isOpen onOpenChange={() => undefined} /></>} /><Route path="/chat" element={<p>Sohbet sayfası</p>} /></Routes></ActiveTemplateProvider></MemoryRouter>)
    await screen.findByText('Yönetici bülteni')
    await userEvent.click(screen.getByText('Hazır bileşenler · 1'))
    await userEvent.click(screen.getByText('Özet kartı').closest('button')!)
    expect(screen.getByTitle('Şablon önizlemesi').getAttribute('srcdoc')).toContain('Hazır özet')
    expect(screen.queryByRole('textbox', { name: 'AI şablon isteği' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yönetici özeti ekle' })).toBeVisible()
    await userEvent.type(screen.getByPlaceholderText('Şablonda ne oluşturmak veya değiştirmek istiyorsunuz?'), 'Daha iyi bir düzen oluştur{enter}')
    await waitFor(() => expect(screen.getByTitle('Şablon önizlemesi').getAttribute('srcdoc')).toContain('AI tasarımı'))
    expect(screen.queryByText('Sohbet sayfası')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/chat'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/report-templates/') && init?.method === 'POST')).toBe(false)
    expect(baseHtml).toContain('ATEZ_COMPONENTS')
  })
})
