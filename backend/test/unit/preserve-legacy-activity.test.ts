import {describe,expect,it,vi} from 'vitest'
import {assignMetadataPreservingActivity,type LegacyActivityModel} from '../../src/modules/documents/application/preserve-legacy-activity'

describe('ownership assignment preserves historical activity',()=>{
 it('keeps chat/report timestamps and ordering while assigning multiple pages',async()=>{
  const rows=[{id:'a',updatedAt:new Date('2026-10-10T12:00:00Z'),visibility:'LEGACY'},{id:'b',updatedAt:new Date('2026-10-11T20:00:00Z'),visibility:'LEGACY'},{id:'c',updatedAt:new Date('2026-10-09T08:00:00Z'),visibility:'LEGACY'}]
  const before=rows.map(row=>row.updatedAt.getTime())
  const model={findMany:vi.fn(async({where,take}:any)=>rows.filter(row=>row.visibility===where.AND[0].visibility&&(!where.AND[1]?.id?.gt||row.id>where.AND[1].id.gt)).slice(0,take).map(row=>({id:row.id,updatedAt:row.updatedAt}))),updateMany:vi.fn(async({where,data}:any)=>{const row=rows.find(row=>row.id===where.id&&row.visibility===where.visibility&&row.updatedAt===where.updatedAt);if(!row)return{count:0};Object.assign(row,data,{updatedAt:data.updatedAt ?? new Date()});return{count:1}})}
  expect(await assignMetadataPreservingActivity(model as unknown as LegacyActivityModel,{visibility:'LEGACY'},{visibility:'PRIVATE',ownerId:'explicit-admin'},1)).toEqual({updated:3,skipped:0})
  for(const [call] of model.findMany.mock.calls)expect(call.where.AND[0]).toEqual({visibility:'LEGACY'});expect(rows.map(row=>row.updatedAt.getTime())).toEqual(before);expect(rows.map(row=>row.visibility)).toEqual(['PRIVATE','PRIVATE','PRIVATE'])
  expect([...rows].sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime()).map(row=>row.id)).toEqual(['b','a','c'])
 })
 it('keeps reviewed report ID limits across all metadata pages',async()=>{
  const stamp=new Date('2026-10-10T10:00:00Z'),rows=[{id:'a',updatedAt:stamp,visibility:'LEGACY'},{id:'b',updatedAt:stamp,visibility:'LEGACY'},{id:'c',updatedAt:stamp,visibility:'LEGACY'}]
  const model={findMany:vi.fn(async({where,take}:any)=>rows.filter(row=>row.visibility===where.AND[0].visibility&&where.AND[0].id.in.includes(row.id)&&(!where.AND[1]?.id.gt||row.id>where.AND[1].id.gt)).slice(0,take)),updateMany:vi.fn(async({where,data}:any)=>{const row=rows.find(row=>row.id===where.id&&row.updatedAt===where.updatedAt&&row.visibility===where.visibility);if(!row)return{count:0};Object.assign(row,data);return{count:1}})}
  expect(await assignMetadataPreservingActivity(model as unknown as LegacyActivityModel,{visibility:'LEGACY',id:{in:['a','c']}},{visibility:'WORKSPACE'},1)).toEqual({updated:2,skipped:0})
  expect(rows.map(row=>row.visibility)).toEqual(['WORKSPACE','LEGACY','WORKSPACE'])
 })
 it('does not overwrite activity changed after the metadata snapshot',async()=>{
  const old=new Date('2026-10-10T10:00:00Z'),current=new Date('2026-10-12T04:00:00Z')
  const model={findMany:vi.fn().mockResolvedValueOnce([{id:'chat',updatedAt:old}]).mockResolvedValueOnce([]),updateMany:vi.fn(async({where}:any)=>({count:where.updatedAt===current?1:0}))}
  expect(await assignMetadataPreservingActivity(model as unknown as LegacyActivityModel,{visibility:'LEGACY'},{visibility:'PRIVATE'})).toEqual({updated:0,skipped:1})
  expect(model.updateMany).toHaveBeenCalledWith({where:{visibility:'LEGACY',id:'chat',updatedAt:old},data:{visibility:'PRIVATE',updatedAt:old}})
 })
})
