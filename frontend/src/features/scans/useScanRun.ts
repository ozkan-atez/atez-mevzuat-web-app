import { useCallback, useEffect, useState } from 'react'
import { getScanRun, ScanApiError } from './api'
import { terminalScanStatuses, type ScanRunDetail } from './types'

interface ScanRunState {
  run: ScanRunDetail | null
  isLoading: boolean
  notFound: boolean
  error: string | null
  refresh: () => Promise<void>
  reconnect: () => Promise<void>
}

export function useScanRun(runId: string | undefined): ScanRunState {
  const [run, setRun] = useState<ScanRunDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionVersion, setConnectionVersion] = useState(0)

  const load = useCallback(async (): Promise<ScanRunDetail | null> => {
    if (!runId) return null
    try {
      const nextRun = await getScanRun(runId)
      setRun(nextRun)
      setNotFound(false)
      setError(null)
      return nextRun
    } catch (caught) {
      if (caught instanceof ScanApiError && caught.status === 404) {
        setRun(null)
        setNotFound(true)
      } else {
        setError(caught instanceof Error ? caught.message : 'Tarama bilgileri alınamadı')
      }
      return null
    } finally {
      setIsLoading(false)
    }
  }, [runId])

  const refresh = useCallback(async () => { await load() }, [load])
  const reconnect = useCallback(async () => {
    await load()
    setConnectionVersion((version) => version + 1)
  }, [load])

  useEffect(() => {
    let disposed = false
    let eventSource: EventSource | null = null
    let pollingTimer: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (pollingTimer || disposed) return
      pollingTimer = setInterval(() => {
        void load().then((nextRun) => {
          if (nextRun && terminalScanStatuses.has(nextRun.status) && pollingTimer) {
            clearInterval(pollingTimer)
            pollingTimer = null
          }
        })
      }, 5_000)
    }

    const connect = async () => {
      const initialRun = await load()
      if (disposed || !runId || (initialRun && terminalScanStatuses.has(initialRun.status))) return
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
  }, [connectionVersion, load, runId])

  return { run, isLoading, notFound, error, refresh, reconnect }
}
