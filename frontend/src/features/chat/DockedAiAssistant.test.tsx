import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockedAiAssistant } from './DockedAiAssistant'
import { ActiveReportProvider, useRegisterActiveReport } from '../revision/ActiveReportContext'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <span data-testid="location">{location.pathname}</span>
      <span data-testid="location-state">{JSON.stringify(location.state ?? {})}</span>
    </>
  )
}

function AssistantHarness({ startOpen = false }: { startOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen)
  return <DockedAiAssistant isOpen={isOpen} onOpenChange={setIsOpen} />
}

function RegisterReport({ submitPrompt }: { submitPrompt: (message: string) => Promise<void> }) {
  useRegisterActiveReport({ topicId: 'topic-1', title: 'İthalat Tebliği', submitPrompt, isPrompting: false })
  return null
}

function renderAssistant(options: { path?: string; report?: (message: string) => Promise<void> } = {}) {
  return render(
    <MemoryRouter initialEntries={[options.path ?? '/']}>
      <ActiveReportProvider>
        {options.report && <RegisterReport submitPrompt={options.report} />}
        <AssistantHarness startOpen />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </ActiveReportProvider>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('DockedAiAssistant', () => {
  it('opens from the compact bottom-center launcher and returns to it when closed', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AssistantHarness /></MemoryRouter>)

    const launcher = screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })
    expect(launcher).toBeVisible()
    expect(launcher.closest('aside')).toHaveClass('left-1/2', '-translate-x-1/2')
    expect(screen.queryByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).not.toBeInTheDocument()

    await user.click(launcher)

    expect(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını kapat' }))

    expect(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })).toBeVisible()
  })

  it('carries a question from the dashboard into the chat workspace', async () => {
    const user = userEvent.setup()
    renderAssistant()

    await user.type(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?'), 'GTİP nedir?{enter}')

    expect(screen.getByTestId('location')).toHaveTextContent('/chat')
    expect(screen.getByTestId('location-state')).toHaveTextContent('GTİP nedir?')
  })

  it('keeps a prompt on the report page as a revision request', async () => {
    const user = userEvent.setup()
    const submitPrompt = vi.fn(async () => undefined)
    renderAssistant({ path: '/reports/topic-1', report: submitPrompt })

    await user.type(screen.getByPlaceholderText(/için revizyon isteyin/), 'Başlığı kısalt{enter}')

    expect(submitPrompt).toHaveBeenCalledWith('Başlığı kısalt')
    expect(screen.getByTestId('location')).toHaveTextContent('/reports/topic-1')
  })
})
