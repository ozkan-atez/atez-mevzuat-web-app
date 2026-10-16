import type { ReactNode } from 'react'

/**
 * Renders the small Markdown subset the model actually produces — paragraphs,
 * bullet and numbered lists, headings, bold, italic and inline code — as React
 * elements.
 *
 * Elements, not HTML: model output is untrusted text, so there is no parser here
 * that could be talked into injecting markup. Anything outside the subset stays
 * visible as the characters the model wrote.
 */
export function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(<p key={`p${blocks.length}`}>{renderInline(paragraph.join(' '))}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)
    blocks.push(list.ordered
      ? <ol key={`l${blocks.length}`} className="list-decimal space-y-1 pl-5">{items}</ol>
      : <ul key={`l${blocks.length}`} className="list-disc space-y-1 pl-5">{items}</ul>)
    list = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push(<p key={`h${blocks.length}`} className="font-semibold text-[var(--atez-text)]">{renderInline(heading[2]!)}</p>)
      continue
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed)
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ? bullet[1] : numbered![2]) ?? '')
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushList()

  return <div className="space-y-2.5">{blocks}</div>
}

const INLINE = /(\[[^\]\n]+\]\(https:\/\/[^\s<>"\)]+\)|\[[^\]\n]+\]\(\/(?:runs|reports|operations)\/(?:documents\/)?[a-zA-Z0-9-]+(?:\?revision=\d+)?\)|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|\/(?:runs|reports|operations)\/(?:documents\/)?[a-zA-Z0-9-]+(?:\?revision=\d+)?)/g

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter((part) => part.length > 0).map((part, index) => {
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="rounded bg-[var(--atez-raised)] px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    const externalLink = /^\[([^\]\n]+)\]\((https:\/\/[^\s<>"\)]+)\)$/.exec(part)
    if (externalLink) {
      try {
        const url = new URL(externalLink[2]!)
        if (url.hostname === 'tariff.singlewindow.io' && url.pathname.startsWith('/api/')) {
          return <span key={index} title="Tariff sorgusu yetkilendirme gerektirir; API bağlantısı tarayıcıdan açılamaz.">Tariff (yetkilendirilmiş sorgu)</span>
        }
        if (url.protocol === 'https:' && !url.username && !url.password) return <a key={index} href={url.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--atez-accent)] underline">{externalLink[1]}</a>
      } catch { /* Malformed model links remain plain text. */ }
    }
    const reportLink = /^\[([^\]\n]+)\]\((\/(?:runs|reports|operations)\/(?:documents\/)?[a-zA-Z0-9-]+(?:\?revision=\d+)?)\)$/.exec(part)
    if (reportLink) return <a key={index} href={reportLink[2]} className="font-semibold text-[var(--atez-accent)] underline">{reportLink[1]}</a>
    if (/^\/(?:runs|reports|operations)\/(?:documents\/)?[a-zA-Z0-9-]+(?:\?revision=\d+)?$/.test(part)) {
      return <a key={index} href={part} className="font-semibold text-[var(--atez-accent)] underline">{part}</a>
    }
    return <span key={index}>{part}</span>
  })
}
