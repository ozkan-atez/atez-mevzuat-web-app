import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { DOCUMENT_MAX_BYTES, DocumentError, assertOfficeArchive, validateDocumentContent } from '../../src/modules/documents/domain/document-content'
import { extractDocumentBytes } from '../../src/modules/documents/application/extract-document'

describe('uploaded document validation and independent extraction',()=>{
  it('validates content instead of trusting a renamed PDF',async()=>{
    await expect(validateDocumentContent(Buffer.from('ordinary text'),'bad.pdf','application/pdf')).rejects.toThrow('uyuşmuyor')
    await expect(validateDocumentContent(Buffer.from([0,1,2,3]),'file.txt','text/plain')).rejects.toThrow('İkili')
    await expect(validateDocumentContent(Buffer.from('hello'),'file.txt','text/plain')).resolves.toBe('text/plain')
  })
  it('rejects empty, oversized and active HTML uploads',async()=>{
    await expect(validateDocumentContent(Buffer.alloc(0),'x.txt')).rejects.toThrow('Boş')
    await expect(validateDocumentContent(Buffer.alloc(DOCUMENT_MAX_BYTES+1),'x.txt')).rejects.toMatchObject({statusCode:413})
    await expect(validateDocumentContent(Buffer.from('<html><script>alert(1)</script></html>'),'x.html','text/html')).rejects.toThrow('HTML')
  })
  it('extracts plain and CSV content without silent truncation',async()=>{
    expect(await extractDocumentBytes(Buffer.from('Türkçe mevzuat'),'text/plain')).toMatchObject({status:'READY',text:'Türkçe mevzuat'})
    expect(await extractDocumentBytes(Buffer.from('GTİP,Oran\n1001,10'),'text/csv')).toMatchObject({metadata:{sections:[{reference:'row:1'},{reference:'row:2'}]}})
    await expect(extractDocumentBytes(Buffer.from('x'.repeat(1_000_001)),'text/plain')).rejects.toThrow('sınırı')
  })
  it('preserves image bytes for explicit OCR instead of inventing text',async()=>{
    expect(await extractDocumentBytes(Buffer.from('image'), 'image/png')).toMatchObject({status:'OCR_REQUIRED',text:null})
  })
  it('extracts spreadsheet sheet/cell references through bounded Office archives',async()=>{
    const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Vergiler');sheet.addRow(['GTİP','Oran']);sheet.addRow(['1001',10])
    const bytes=Buffer.from(await workbook.xlsx.writeBuffer())
    await expect(validateDocumentContent(bytes,'data.xlsx')).resolves.toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const result=await extractDocumentBytes(bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(result.status).toBe('READY');expect(result.text).toContain('A2: 1001');expect(result.metadata.sections[1]?.reference).toBe('Vergiler!row:2')
  })
  it('checks zip expansion before decompressing and rejects malformed archives',()=>{
    expect(()=>assertOfficeArchive(Buffer.from('invalid'))).toThrow(DocumentError)
    const bytes=Buffer.alloc(68);bytes.writeUInt32LE(0x02014b50,0);bytes.writeUInt32LE(1,20);bytes.writeUInt32LE(60_000_000,24);bytes.writeUInt32LE(0x06054b50,46);bytes.writeUInt16LE(1,56)
    expect(()=>assertOfficeArchive(bytes)).toThrow('sınır')
  })
  it('strips active HTML from URL imports and marks unreadable PDFs explicitly',async()=>{
    expect(await extractDocumentBytes(Buffer.from('<html><body><script>malicious</script><p>Public text</p></body></html>'),'text/html')).toMatchObject({text:'Public text'})
    await expect(extractDocumentBytes(Buffer.from('%PDF-1.7 broken'),'application/pdf')).rejects.toThrow()
  })
})
