import { describe, expect, it } from 'vitest'
import { resolveInput } from '../src/schedules'

describe('takvim girdisi', () => {
  it('$today değerini saat dilimine göre çözer', () => {
    // 2026-10-16 22:30 UTC = 2026-10-17 01:30 İstanbul
    expect(resolveInput({ date: '$today', sourceId: 'resmi-gazete' }, 'Europe/Istanbul', new Date('2026-10-16T22:30:00Z'))).toEqual({
      date: '2026-10-17',
      sourceId: 'resmi-gazete',
    })
  })
})
