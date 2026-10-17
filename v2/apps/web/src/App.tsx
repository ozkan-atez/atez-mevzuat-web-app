import { useEffect, useState } from 'react'
import { ComponentPool } from './pages/ComponentPool'
import { TemplateEditor, TemplateList } from './pages/Templates'

function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash || '#/components')
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/components')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [hash, (h) => (window.location.hash = h)]
}

export function App() {
  const [hash, go] = useHash()
  const [path, query] = hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  const tpl = path?.match(/^\/templates\/([0-9a-f-]{36})$/)
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">
          <span className="logo-mark">A</span>
          <div>
            <strong>Mevzuat Radarı</strong>
            <span>Şablon stüdyosu</span>
          </div>
        </div>
        <a className={path?.startsWith('/components') ? 'on' : ''} href="#/components">
          Bileşen havuzu
        </a>
        <a className={path?.startsWith('/templates') ? 'on' : ''} href="#/templates">
          Şablonlar
        </a>
      </nav>
      <div className="content">
        {path?.startsWith('/components') && <ComponentPool key={hash} openAi={params.get('ai') === '1'} />}
        {path === '/templates' && <TemplateList go={go} />}
        {tpl && <TemplateEditor key={tpl[1]} id={tpl[1]!} go={go} />}
      </div>
    </div>
  )
}
