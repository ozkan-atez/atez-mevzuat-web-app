import { useEffect, useRef, useState } from 'react'

/**
 * Sandbox'lı önizleme: script çalışmaz (sandbox=""), HTML API'de escape edilerek üretilir ve
 * CSP meta etiketi taşır. Yükseklik içeriğe göre ayarlanır (aynı köken yok; boyut ölçümü
 * yalnızca sandbox'sız erişimle olur, bu yüzden sabit/ölçekli yükseklik kullanılır).
 */
export function Preview({ html, height = 260, scale = 1, title }: { html: string | null | undefined; height?: number; scale?: number; title: string }) {
  if (!html) return <div className="preview-empty">Önizleme yok</div>
  return (
    <div className="preview-frame" style={{ height }}>
      <iframe
        title={title}
        sandbox=""
        srcDoc={html}
        style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: '0 0', width: `${100 / scale}%`, height: `${height / scale}px` }}
      />
    </div>
  )
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
