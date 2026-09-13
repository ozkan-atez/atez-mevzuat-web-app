import { useCallback, useEffect, useState } from 'react'
import { getScanRun, ScanApiError } from './api'
import { terminalScanStatuses, type ScanRunDetail } from './types'

interface ScanRunState {
  run: ScanRunDetail | null
  isLoading: boolean
  notFound: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useScanRun(runId: string | undefined): ScanRunState {
  const [run, setRun] = useState<ScanRunDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!runId) return
    try {
      const nextRun = await getScanRun(runId)
      setRun(nextRun)
      setNotFound(false)
      setError(null)
    } catch (caught) {
      if (caught instanceof ScanApiError && caught.status === 404) {
        setRun(null)
        setNotFound(true)
      } else {
        setError(caught instanceof Error ? caught.message : 'Tarama bilgileri alınamadı')
      }
    } finally {
      setIsLoading(false)
    }
  }, [runId])

  useEffect(() => {
    let disposed = false
    let eventSource: EventSource | null = null
    let pollingTimer: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (pollingTimer || disposed) return
      pollingTimer = setInterval(() => void refresh(), 5_000)
    }

    const connect = async () => {
      await refresh()
      if (disposed || !runId) return
      try {
        eventSource = new EventSource(`/api/v1/scan-runs/${runId}/events`)
        eventSource.addEventListener('scan.snapshot', (event) => {
          const nextRun = JSON.parse((event as MessageEvent<string>).data) as ScanRunDetail
          setRun(nextRun)
          setError(null)
          if (terminalScanStatuses.has(nextRun.status)) eventSource?.close()
        })
        eventSource.onerror = () => {
          eventSource?.close()
          startPolling()
        }
      } catch {
        startPolling()
      }
    }

    void connect()
    return () => {
      disposed = true
      eventSource?.close()
      if (pollingTimer) clearInterval(pollingTimer)
    }
  }, [refresh, runId])

  return { run, isLoading, notFound, error, refresh }
}
