import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

interface ActiveTemplate {
  submitPrompt: (message: string) => Promise<void>
  isPrompting: boolean
}

const Context = createContext<{ active: ActiveTemplate | null; setActive: (value: ActiveTemplate | null) => void }>({ active: null, setActive: () => undefined })

export function ActiveTemplateProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveTemplate | null>(null)
  const value = useMemo(() => ({ active, setActive }), [active])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useActiveTemplate() { return useContext(Context).active }

export function useRegisterActiveTemplate(active: ActiveTemplate) {
  const { setActive } = useContext(Context)
  const submitPrompt = useCallback((message: string) => active.submitPrompt(message), [active.submitPrompt])
  useEffect(() => { setActive({ submitPrompt, isPrompting: active.isPrompting }); return () => setActive(null) }, [active.isPrompting, setActive, submitPrompt])
}
