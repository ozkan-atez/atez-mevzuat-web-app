import {describe,expect,it} from 'vitest'
import {normalizeGrounding,withWebCitations} from '../../src/modules/chat/application/web-grounding'
describe('web research citations',()=>{
 it('uses UTF-8 byte offsets for Turkish text and remaps filtered sources',()=>{
   const text='Gümrük değişikliği yayımlandı.'
   const research=normalizeGrounding({groundingChunks:[{web:{uri:'javascript:alert(1)',title:'Bad'}},{web:{uri:'https://www.resmigazete.gov.tr/doc.htm',title:'Resmî Gazete'}}],groundingSupports:[{segment:{endIndex:Buffer.byteLength(text),text},groundingChunkIndices:[0,1]}],webSearchQueries:['gümrük'],searchEntryPoint:{renderedContent:'<div>Öneriler</div>'}})
   expect(research.sources).toEqual([{url:'https://www.resmigazete.gov.tr/doc.htm',title:'Resmî Gazete'}])
   expect(withWebCitations(text,research)).toBe(text+' [1](https://www.resmigazete.gov.tr/doc.htm)')
 })
 it('does not attach citations whose segment does not match the answer',()=>{
   const research=normalizeGrounding({groundingChunks:[{web:{uri:'https://example.com'}}],groundingSupports:[{segment:{endIndex:3,text:'Different'},groundingChunkIndices:[0]}]})
   expect(withWebCitations('abc',research)).toBe('abc')
 })
})
