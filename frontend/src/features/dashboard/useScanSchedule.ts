import { useEffect, useState } from 'react'
import { getScanSchedule } from '../scans/api'
import type { ScheduleView } from '../scans/types'

const POLL_INTERVAL_MS = 30_000

/**
 * The daily schedule is rendered in two places on the dashboard — the hero status line and
 * the process bar below it — so it is fetched once here and handed to both.
 */
export function useScanSchedule(): ScheduleView | null {
  const [schedule, setSchedule] = useState<ScheduleView | null>(null)

  useEffect(() => {
    let active = true
    const load = () => {
      void getScanSchedule()
        .then((next) => { if (active) setSchedule(next) })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, POLL_INTERVAL_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  return schedule
}
