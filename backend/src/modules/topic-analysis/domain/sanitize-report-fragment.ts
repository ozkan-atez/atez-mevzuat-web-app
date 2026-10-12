import { load } from 'cheerio'

const allowedStyles = new Set(['color','background-color','border','border-color','border-width','border-style','border-radius','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','text-align','font-size','font-weight','font-family','line-height','display','grid-template-columns','gap','width','max-width','min-width','flex-direction','align-items','justify-content'])
export function sanitizeReportStyle(style: string): string {
  return style.split(';').map(item => item.trim()).filter(Boolean).flatMap(item => {
    const separator = item.indexOf(':')
    if (separator < 1) return []
    const property = item.slice(0,separator).trim().toLowerCase()
    const value = item.slice(separator+1).trim()
    if (!allowedStyles.has(property) || !/^[a-zA-Z0-9#(),.%\s-]+$/.test(value) || /url|expression|javascript|import/i.test(value)) return []
    return [`${property}: ${value}`]
  }).join('; ')
}


/** Allow only printable report content. No network assets, executable markup or CSS. */
export function sanitizeReportFragment(html: string): string {
  const $ = load(html, {}, false)
  $('script,style,iframe,object,embed,form,input,button,link,meta,svg,math,img,template').remove()
  const classes = new Set(['block','note','note--alert','compare','compare-cell','is-new','table-section','table-scroll','data-table','data-table--wide','table-notes','timeline','timeline-row','timeline-date','timeline-text','chip','chip--official','chip--supporting','rule','source-label','badge','badge--alert','badge--info','metadata','label','title-value','source-class','source-class-head','empty-state','empty-title','info-mark','info-box'])
  const allowed = new Set(['section','aside','div','h1','p','span','h2','h3','h4','strong','b','em','i','u','s','ul','ol','li','table','thead','tbody','tr','th','td','br','hr','a','blockquote'])
  $('*').each((_, element) => {
    if (!('tagName' in element) || !('attribs' in element)) return
    const node = $(element)
    if (!allowed.has(element.tagName)) { node.replaceWith(node.contents()); return }
    for (const key of Object.keys(element.attribs)) {
      const value = element.attribs[key] ?? ''
      if (key === 'style') { const safe = sanitizeReportStyle(value); if (safe) node.attr('style',safe); else node.removeAttr('style'); continue }
      if (key === 'class') {
        const safe = value.split(/\s+/).filter(item => classes.has(item)).join(' ')
        if (safe) node.attr('class', safe); else node.removeAttr('class')
        continue
      }
      if (element.tagName === 'a' && key === 'href' && /^https?:\/\//i.test(value)) continue
      if (['colspan','rowspan'].includes(key) && /^(?:[1-9]|[1-9][0-9])$/.test(value)) continue
      node.removeAttr(key)
    }
    if (element.tagName === 'a') node.attr('rel','noreferrer')
  })
  return $.html()
}
