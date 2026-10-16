import {createHash} from 'node:crypto'
import {providerFieldInventory} from './tariff-catalog'

/** Preserve provider evidence before any field selection or normalization. */
export function createTariffSnapshot(raw:unknown,request:{gtip:string;queryDate:string;url:string},fetchedAt=new Date().toISOString()){
 if(!raw||typeof raw!=='object'||!Array.isArray(Reflect.get(raw,'measures'))||!Array.isArray(Reflect.get(raw,'commodities')))throw new Error('Tariff yanıtı measures ve commodities dizilerini içermeli.')
 const payload=structuredClone(raw)
 return {schemaVersion:'1',role:'SUPPORTING_TARIFF',request,fetchedAt,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),raw:payload,availableFields:providerFieldInventory(payload),
  validation:{status:'UNVALIDATED',note:'Yanıt sorgu tarihinden sonraki kayıtları da içerebilir. Önce tarih, önlem türü, menşe/grup ve birim eşleşmesi doğrulanmalı; yalnız alan seçimi yeterli değildir.'}}
}
