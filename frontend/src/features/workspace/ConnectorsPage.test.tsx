import {cleanup,render,screen,waitFor,fireEvent} from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {ConnectorsPage} from './ConnectorsPage'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const source={id:'s',name:'Kaynak',key:'custom',baseUrl:'https://example.org',profiles:[{status:'VERIFIED',validation:{message:'Örnek içerik doğrulandı.'}}]}
function mockFetch(write?:(options:RequestInit)=>void){vi.stubGlobal('fetch',vi.fn(async(url:unknown,options?:RequestInit)=>{
 if(options?.method==='POST'){write?.(options);return new Response(JSON.stringify({status:'SETUP_QUEUED'}),{status:202})}
 const body=String(url).includes('documents?')?{documents:[]}:String(url).includes('managed-sources')?{sources:[]}:{sources:[source]}
 return new Response(JSON.stringify(body))
}))}
describe('connector controls',()=>{
 it('accepts a dropped file, derives a name and allows removal',async()=>{mockFetch();render(<ConnectorsPage/>);await userEvent.click(screen.getByRole('button',{name:/Kaynak ekle/}));await userEvent.click(screen.getByText('Yerel dosya'));const drop=screen.getByRole('button',{name:/Belgenizi buraya sürükleyin/});fireEvent.drop(drop,{dataTransfer:{files:[new File(['hello'],'Gümrük notları.txt',{type:'text/plain'})]}});expect(screen.getByLabelText('Kaynak adı')).toHaveValue('Gümrük notları');expect(screen.getByText('Gümrük notları.txt')).toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Dosyayı kaldır'}));expect(screen.queryByText('Gümrük notları.txt')).not.toBeInTheDocument()})
 it('rejects unsupported and multiple dropped files before upload',async()=>{mockFetch();render(<ConnectorsPage/>);await userEvent.click(screen.getByRole('button',{name:/Kaynak ekle/}));await userEvent.click(screen.getByText('Yerel dosya'));const drop=screen.getByRole('button',{name:/Belgenizi buraya sürükleyin/});fireEvent.drop(drop,{dataTransfer:{files:[new File(['test'],'tool.exe')]}});expect(await screen.findByText(/Bu dosya türü desteklenmiyor/)).toBeInTheDocument();fireEvent.drop(drop,{dataTransfer:{files:[new File(['1'],'a.txt'),new File(['2'],'b.txt')]}});expect(await screen.findByText('Her seferinde bir belge ekleyin.')).toBeInTheDocument()})

 it('explains an access challenge without promising browser session transfer',async()=>{vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>new Response(JSON.stringify(String(url).includes('documents?')?{documents:[]}:String(url).includes('managed-sources')?{sources:[]}:{sources:[{...source,profiles:[{status:'NEEDS_REVIEW',validation:{message:'USER_ACTION_REQUIRED: Kaynak insan doğrulaması istiyor.'}}]}]}))));render(<ConnectorsPage/>);await userEvent.click(await screen.findByRole('button',{name:'Kontrol gerekli · Ayrıntılar'}));expect(await screen.findByText(/arka plandaki tarayıcıya aktarılmaz/)).toBeInTheDocument();expect(screen.getByText('Kaynağı tarayıcıda aç')).toHaveAttribute('href','https://example.org')})
 it('does not report an empty catalog when the backend route fails',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({message:'Kaynak listesi yüklenemedi.'}),{status:404})));render(<ConnectorsPage/>);expect(await screen.findByText('Kaynak listesi yüklenemedi.')).toBeVisible();expect(screen.queryByText('Henüz kaynak eklenmedi.')).not.toBeInTheDocument()})
 it('has one test action per source and sends a setup request',async()=>{mockFetch();render(<ConnectorsPage/>);await userEvent.click(await screen.findByRole('button',{name:'Test et'}));await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/v1/connectors/s/test',expect.objectContaining({method:'POST'})));expect(screen.queryByText('Kaynağı tara')).not.toBeInTheDocument();expect(screen.queryByText('Tek adım çalıştır')).not.toBeInTheDocument()})
 it('uploads a local original document with the connector option',async()=>{
  let sent:FormData|undefined;mockFetch(options=>{sent=options.body as FormData});render(<ConnectorsPage/>);
  await userEvent.click(screen.getByRole('button',{name:/Kaynak ekle/}));await userEvent.click(screen.getByText('Yerel dosya'));
  await userEvent.type(screen.getByLabelText('Kaynak adı'),'Ek belge');await userEvent.upload(screen.getByLabelText('Belge'),new File(['%PDF-1.7'],'ek.pdf',{type:'application/pdf'}));
  await userEvent.click(screen.getByRole('button',{name:'Belgeyi ekle'}));await waitFor(()=>expect(sent?.get('originalOnly')).toBe('true'));expect((sent?.get('file') as File).name).toBe('ek.pdf')
 })
})

describe('source management',()=>{
 it('edits a source name and address',async()=>{
  mockFetch();render(<ConnectorsPage/>);
  await userEvent.click(await screen.findByRole('button',{name:'Kaynak kaynağını düzenle'}));
  await userEvent.clear(screen.getByLabelText('Kaynak adı'));await userEvent.type(screen.getByLabelText('Kaynak adı'),'Yeni kaynak');
  await userEvent.clear(screen.getByLabelText('Kaynak bağlantısı'));await userEvent.type(screen.getByLabelText('Kaynak bağlantısı'),'https://example.org/news');
  await userEvent.click(screen.getByRole('button',{name:'Kaydet'}));
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/v1/sources/s',expect.objectContaining({method:'PATCH',body:JSON.stringify({name:'Yeni kaynak',baseUrl:'https://example.org/news'})})));
 })
 it('requires confirmation to delete and hides inactive sources after reload',async()=>{
  let deleted=false
  vi.stubGlobal('fetch',vi.fn(async(url:unknown,options?:RequestInit)=>{
   if(options?.method==='DELETE'){deleted=true;return new Response(null,{status:204})}
   return new Response(JSON.stringify(String(url).includes('documents?')?{documents:[]}:String(url).includes('managed-sources')?{sources:[]}:{sources:[{...source,isActive:!deleted}]}))
  }))
  render(<ConnectorsPage/>);await userEvent.click(await screen.findByRole('button',{name:'Kaynak kaynağını sil'}));
  expect(deleted).toBe(false);await userEvent.click(screen.getByRole('button',{name:'Vazgeç'}));expect(deleted).toBe(false)
  await userEvent.click(screen.getByRole('button',{name:'Kaynak kaynağını sil'}));await userEvent.click(screen.getByRole('button',{name:'Sil'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Kaynak kaynağını sil'})).not.toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith('/api/v1/sources/s',expect.objectContaining({method:'DELETE'}))
 })
 it('keeps the editor open when saving fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:unknown,options?:RequestInit)=>new Response(JSON.stringify(options?.method==='PATCH'?{message:'Kaydedilemedi.'}:String(url).includes('documents?')?{documents:[]}:String(url).includes('managed-sources')?{sources:[]}:{sources:[source]}),{status:options?.method==='PATCH'?500:200})))
  render(<ConnectorsPage/>);await userEvent.click(await screen.findByRole('button',{name:'Kaynak kaynağını düzenle'}));await userEvent.click(screen.getByRole('button',{name:'Kaydet'}));
  expect(await screen.findByText('Kaydedilemedi.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Kaydet'})).toBeEnabled();expect(screen.getByLabelText('Kaynak adı')).toHaveValue('Kaynak')
 })
})
