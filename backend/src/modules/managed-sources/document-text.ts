import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
/** Check ZIP directory sizes before handing Office containers to their parsers. */
export function validateOfficeArchive(bytes:Buffer) {
  let total=0,entries=0
  for(let pos=0;pos+46<=bytes.length;pos++)if(bytes.readUInt32LE(pos)===0x02014b50) {
    entries++;total+=bytes.readUInt32LE(pos+24)
    if(total>50_000_000||entries>2000)throw new Error('Office dosyasının açılmış boyutu güvenli sınırı aşıyor.')
    const name=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32);pos+=45+name+extra+comment
  }
  if(!entries)throw new Error('Office dosyası doğrulanamadı.')
}
export async function extractOfficeText(bytes:Buffer,mediaType:string):Promise<string|null> {
  if(!/wordprocessingml|spreadsheetml/.test(mediaType))return null
  validateOfficeArchive(bytes)
  if(mediaType.includes('wordprocessingml'))return (await mammoth.extractRawText({buffer:bytes})).value.slice(0,80000)||null
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any)
  const parts:string[]=[];let count=0
  for(const sheet of workbook.worksheets){parts.push(sheet.name);sheet.eachRow(row=>{if(count++<5000)parts.push(row.values instanceof Array?row.values.map(cell=>typeof cell==='object'&&cell!==null?('text'in cell?cell.text:'result'in cell?cell.result:JSON.stringify(cell)):cell).join('\t'):String(row.values))})}
  return parts.join('\n').slice(0,80000)||null
}
