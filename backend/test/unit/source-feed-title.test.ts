import {it,expect} from 'vitest'
import {builtinProfile} from '../../src/modules/managed-sources/source-profile'
import {collectSource} from '../../src/modules/managed-sources/source-collector'
it('genelge başlığını Detay bağlantısından değil tablo hücresinden alır',async()=>{
 const profile=builtinProfile('ticaret-bakanligi')!;profile.feeds=[profile.feeds[1]!]
 const result=await collectSource(profile,'2026-01-07',{html:async()=>'<table><tr><td>EK-24 Gümrük Laboratuvarları Tahlil Ücretleri Listesi</td><td>2026/2</td><td>07.01.2026</td><td><a href="/data/genelge.pdf">Detay</a><a href="/data/ek.docx">Genelge eki</a></td></tr></table>',binary:async()=>{throw Error('not needed')},close:async()=>{}},null)
 expect(result.items[0]?.title).toBe('EK-24 Gümrük Laboratuvarları Tahlil Ücretleri Listesi')
 expect(result.items[0]?.publishedOn).toBe('2026-01-07')
 expect(result.items[0]?.attachments).toEqual([{url:'https://ticaret.gov.tr/data/ek.docx',title:'Genelge eki'}])
})
