import { useCallback, useEffect, useState } from 'react'

export function useResource<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true)
    try { setData(await loader()); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Kayıtlar alınamadı.') }
    finally { setLoading(false) }
  }, [loader])
  useEffect(() => { void refresh() }, [refresh])
  return { data, loading, error, refresh }
}
