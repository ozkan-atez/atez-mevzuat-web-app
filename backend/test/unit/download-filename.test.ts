import {describe,it,expect} from 'vitest'
import {downloadFilename} from '../../src/modules/documents/application/download-filename'
describe('original download filename',()=>{
 it('restores the HTM filename from the source URL when the archive has no name',()=>{
  expect(downloadFilename(null,'https://www.resmigazete.gov.tr/eskiler/2026/10/20261010-17.htm','text/html')).toBe(`attachment; filename="20261010-17.htm"; filename*=UTF-8''20261010-17.htm`)
 })
 it('adds the stored format extension to nameless or extensionless files',()=>{
  expect(downloadFilename(null,null,'text/html')).toContain('filename="belge.htm"')
  expect(downloadFilename('ek',null,'application/pdf')).toContain('filename="ek.pdf"')
 })
 it('keeps HTML aliases and Turkish names and excludes header control characters',()=>{
  expect(downloadFilename('örnek.html',null,'text/html')).toContain("filename*=UTF-8''%C3%B6rnek.html")
  expect(downloadFilename('test\r\n".htm',null,'text/html')).not.toMatch(/[\r\n]/)
 })
 it('does not mislabel stored text as HTML just because the source URL ends in htm',()=>{
  expect(downloadFilename(null,'https://example.org/a.htm','text/plain')).toContain('filename="a.txt"')
 })
})
