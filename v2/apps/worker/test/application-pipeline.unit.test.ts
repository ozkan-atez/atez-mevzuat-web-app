import { expect, it } from 'vitest'
import { createApplicationPipeline } from '../src/application-pipeline'
it('rejects the application database before opening a runtime',async()=>{
 await expect(createApplicationPipeline({DATABASE_URL:'postgresql://localhost/main',STUDIO_DATABASE_URL:'postgresql://localhost/main'})).rejects.toThrow('separate database')
})
it('rejects the legacy queue virtual host before declaring conflicting exchanges',async()=>{
 const databases={DATABASE_URL:'postgresql://localhost/main',STUDIO_DATABASE_URL:'postgresql://localhost/studio'}
 await expect(createApplicationPipeline(databases)).rejects.toThrow('separate RabbitMQ')
 await expect(createApplicationPipeline({...databases,RABBITMQ_URL:'amqp://localhost/',V2_AMQP_URL:'amqp://localhost/'})).rejects.toThrow('separate RabbitMQ')
})
