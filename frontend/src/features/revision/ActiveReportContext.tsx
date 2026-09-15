import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface ActiveReport {
  topicId: string
  title: string
  submitPrompt: (message: string) => Promise<void>
  isPrompting: boolean
}

interface ActiveReportContextValue {
  active: ActiveReport | null
  setActive: (report: ActiveReport | null) => void
}

const ActiveReportContext = createContext<ActiveReportContextValue>({ active: null, setActive: () => undefined })

/**
 * Carries which report the user is looking at, so the docked assistant can send a
 * revision request for it. The page registers itself; the assistant only reads.
 */
export function ActiveReportProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveReport | null>(null)
  const value = useMemo(() => ({ active, setActive }), [active])
  return <ActiveReportContext.Provider value={value}>{children}</ActiveReportContext.Provider>
}

export function useActiveReport(): ActiveReport | null {
  return useContext(ActiveReportContext).active
}

/** Registers the open report while this component is mounted. */
export function useRegisterActiveReport(report: ActiveReport | null): void {
  const { setActive } = useContext(ActiveReportContext)
  const topicId = report?.topicId
  const title = report?.title
  const isPrompting = report?.isPrompting ?? false
  const submitPrompt = report?.submitPrompt

  const stableSubmit = useCallback(async (message: string) => {
    await submitPrompt?.(message)
  }, [submitPrompt])

  useEffect(() => {
    if (!topicId || !title) {
      setActive(null)
      return
    }
    setActive({ topicId, title, submitPrompt: stableSubmit, isPrompting })
    return () => setActive(null)
  }, [isPrompting, setActive, stableSubmit, title, topicId])
}
