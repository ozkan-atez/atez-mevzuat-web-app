import type { TemplateSection } from './template-sections'
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
/** Model output is plain text; visual components are rendered only by the application. */
export function renderSemanticContent(section:Pick<TemplateSection,'componentType'>,content:string,evidenceStatus='SUPPORTED') {
 if(evidenceStatus==='MISSING')return `<p>${escape(content||'Bu bölüm için yeterli kaynak kanıtı bulunamadı.')}</p>`
 const lines=content.split('\n').map(s=>s.trim()).filter(Boolean)
 if(section.componentType==='list')return `<ul>${lines.map(line=>`<li>${escape(line.replace(/^[-*]\s+/,''))}</li>`).join('')}</ul>`
 if(section.componentType==='table'){
  const rows=lines.filter(line=>line.includes('|')&&!/^\|?[\s:|-]+\|?$/.test(line)).map(line=>line.replace(/^\||\|$/g,'').split('|').map(s=>s.trim()))
  if(rows.length>=2&&rows.every(row=>row.length===rows[0]!.length))return `<div class="table-section"><table><thead><tr>${rows[0]!.map(cell=>`<th>${escape(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
 }
 return lines.map(line=>`<p>${escape(line)}</p>`).join('')
}
