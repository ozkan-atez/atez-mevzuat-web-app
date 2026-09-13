import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DockedAiAssistant } from './DockedAiAssistant'

function AssistantHarness() {
  const [isOpen, setIsOpen] = useState(false)
  return <DockedAiAssistant isOpen={isOpen} onOpenChange={setIsOpen} />
}

describe('DockedAiAssistant', () => {
  it('opens from the compact bottom-center launcher and returns to it when closed', async () => {
    const user = userEvent.setup()
    render(<AssistantHarness />)

    const launcher = screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })
    expect(launcher).toBeVisible()
    expect(launcher.closest('aside')).toHaveClass('left-1/2', '-translate-x-1/2')
    expect(launcher).toHaveClass('hover:scale-125', 'transition-all', 'duration-300')
    expect(screen.queryByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).not.toBeInTheDocument()

    await user.click(launcher)

    const input = screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')
    expect(input).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını kapat' }))

    expect(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })).toBeVisible()
    expect(screen.queryByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).not.toBeInTheDocument()
  })
})
