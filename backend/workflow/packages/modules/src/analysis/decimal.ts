/**
 * Ondalık değerler string olarak taşınır ve aritmetik kodla, ölçeklenmiş BigInt ile yapılır
 * (kayan nokta yok). Sayı biçimi kuralı (§7): iki ayırıcı türü varsa sondaki ondalıktır; tek
 * ayırıcıdan sonra tam 3 hane geliyorsa binlik ayırıcıdır (ör. "4.500" = 4500).
 */
const SCALE = 6n
const FACTOR = 10n ** SCALE

export function normalizeDecimal(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  let s = raw.replace(/[\s ]/g, '').replace(/^%|%$/g, '').replace(/^[+]/, '')
  if (!s) return null
  if (!/^-?[\d.,]+$/.test(s)) return null
  const neg = s.startsWith('-')
  if (neg) s = s.slice(1)
  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length
  let intPart: string
  let frac = ''
  if (dots && commas) {
    const decSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const thouSep = decSep === '.' ? ',' : '.'
    const [i, f] = s.split(decSep)
    if (s.split(decSep).length !== 2) return null
    intPart = i!.split(thouSep).join('')
    frac = f!
    if (!validGroups(i!, thouSep)) return null
  } else if (dots || commas) {
    const sep = dots ? '.' : ','
    const parts = s.split(sep)
    if (parts.length > 2) {
      if (!validGroups(s, sep)) return null
      intPart = parts.join('')
    } else if (parts[1]!.length === 3 && parts[0]!.length > 0 && parts[0] !== '0') {
      intPart = parts.join('') // binlik
    } else {
      intPart = parts[0]!
      frac = parts[1]!
    }
  } else {
    intPart = s
  }
  if (!/^\d+$/.test(intPart || '0') || !/^\d*$/.test(frac)) return null
  const i = (intPart || '0').replace(/^0+(?=\d)/, '')
  const f = frac.replace(/0+$/, '')
  return `${neg ? '-' : ''}${i}${f ? `.${f}` : ''}`
}

function validGroups(s: string, sep: string): boolean {
  const g = s.split(sep)
  return g[0]!.length >= 1 && g[0]!.length <= 3 && g.slice(1).every((x) => x.length === 3)
}

function toScaled(d: string): bigint {
  const neg = d.startsWith('-')
  const [i, f = ''] = (neg ? d.slice(1) : d).split('.')
  const v = BigInt(i!) * FACTOR + BigInt((f + '000000').slice(0, Number(SCALE)))
  return neg ? -v : v
}

export function compareDecimal(a: string, b: string): number {
  const x = toScaled(a)
  const y = toScaled(b)
  return x === y ? 0 : x < y ? -1 : 1
}

/** (yeni − eski) / eski × 100, iki ondalığa yuvarlanmış; eski 0 ise null. */
export function percentChange(previous: string, current: string): string | null {
  const p = toScaled(previous)
  const c = toScaled(current)
  if (p === 0n) return null
  // ×10000 → iki ondalık hassasiyetle yüzde; yarım yukarı yuvarlama
  const num = (c - p) * 100n * 100n * 10n
  let q = num / p
  const sign = q < 0n ? -1n : 1n
  q = (q + sign * 5n) / 10n
  const abs = q < 0n ? -q : q
  return `${q < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}
