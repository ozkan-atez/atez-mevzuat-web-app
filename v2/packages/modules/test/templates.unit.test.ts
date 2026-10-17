import { describe, expect, it } from 'vitest'
import { BUILTIN_COMPONENTS, SAMPLE_CONTEXT, appliesTo, pairOrphanSlot, renderComponent, validateComponent } from '../src/index'

describe('yerleşik bileşenler', () => {
  for (const b of BUILTIN_COMPONENTS) {
    it(`${b.key} doğrulamadan geçer`, () => {
      const v = validateComponent(b.definition)
      expect(v.issues).toEqual([])
    })
  }
  it('görünme kuralları örnek analizde beklendiği gibi', () => {
    const visible = BUILTIN_COMPONENTS.filter((b) => appliesTo(b.definition, SAMPLE_CONTEXT).visible).map((b) => b.key)
    expect(visible).toContain('karsilastirma-tablosu')
    expect(visible).not.toContain('gtip-tablosu')
    expect(visible).not.toContain('sure-uzatimi')
  })
})

describe('doğrulama ve güvenli render', () => {
  const base = { schemaVersion: 1, slots: [], appliesWhen: '', bindings: [], sampleData: { slots: {} } }
  it('olmayan veri bağını, izinsiz sınıfı ve tanımsız slotu reddeder', () => {
    const v = validateComponent({
      ...base,
      nodes: [
        { type: 'text', bind: 'analysis.yok' },
        { type: 'text', text: 'x', classes: ['evil'] },
        { type: 'text', slot: 'tanimsiz' },
        { type: 'table', bind: 'analysis.comparison.rows', columns: [{ header: 'A', value: 'olmayan' }] },
      ],
    })
    expect(v.ok).toBe(false)
    expect(v.issues.join(' | ')).toMatch(/analysis\.yok.*analizde yok/)
    expect(v.issues.join(' | ')).toMatch(/izinli olmayan sınıf "evil"/)
    expect(v.issues.join(' | ')).toMatch(/slot "tanimsiz" tanımlanmamış/)
    expect(v.issues.join(' | ')).toMatch(/"olmayan" alanı yok/)
  })
  it('şema dışı alanları (inline stil, script) kabul etmez', () => {
    expect(validateComponent({ ...base, nodes: [{ type: 'text', text: 'x', style: 'color:red' }] }).ok).toBe(false)
    expect(validateComponent({ ...base, nodes: [{ type: 'script', text: 'alert(1)' }] }).ok).toBe(false)
  })
  it('metin escape edilir', () => {
    const html = renderComponent({ ...base, schemaVersion: 1, nodes: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] } as never, SAMPLE_CONTEXT, {})
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
  it('bindings kodla hesaplanır', () => {
    const v = validateComponent({ ...base, nodes: [{ type: 'text', bind: 'analysis.summary' }, { type: 'list', bind: 'analysis.exceptions' }] })
    expect(v.definition?.bindings).toEqual(['analysis.exceptions', 'analysis.summary'])
  })
  it('geçersiz CEL kuralı yakalanır', () => {
    expect(validateComponent({ ...base, appliesWhen: 'size(', nodes: [{ type: 'text', text: 'x' }] }).issues.join()).toMatch(/appliesWhen/)
  })
})

import { TemplateDefinition } from '@atez/contracts'
describe('şablon eksik veri kuralı', () => {
  it('yalnızca NOTE | OMIT; BLOCK yok', () => {
    const base = { schemaVersion: 1, title: 't', description: '', brief: '', theme: { tokens: {} }, shell: { heading: 'h', showFooter: true } }
    const sec = { id: 'ozet', componentKey: 'ozet', componentVersion: 1, enabled: true, order: 0, heading: 'Özet', sectionDescription: '', required: false }
    expect(TemplateDefinition.safeParse({ ...base, sections: [{ ...sec, missingDataRule: 'NOTE' }] }).success).toBe(true)
    expect(TemplateDefinition.safeParse({ ...base, sections: [{ ...sec, missingDataRule: 'BLOCK' }] }).success).toBe(false)
  })
})

describe('pairOrphanSlot', () => {
  const base = {
    reply: '', name: 'x', description: '', category: 'NOT_UYARI' as const, appliesWhen: '', sampleSlots: [],
    slots: [{ key: 'warning', kind: 'text' as const, instruction: 'uyarı' }, { key: 'actions', kind: 'list' as const, instruction: 'adımlar' }],
  }
  it('kaynaksız tek metin node\'u ile kullanılmayan tek text slot\'unu eşler', () => {
    const out = pairOrphanSlot({ ...base, nodes: [{ type: 'note', variant: 'alert', parent: null }, { type: 'list', slot: 'actions', parent: null }] } as never)
    expect(out.nodes[0]!.slot).toBe('warning')
  })
  it('belirsizse dokunmaz', () => {
    const two = { ...base, nodes: [{ type: 'note', parent: null }, { type: 'text', parent: null }, { type: 'list', slot: 'actions', parent: null }] } as never
    expect(pairOrphanSlot(two)).toBe(two)
  })
})
