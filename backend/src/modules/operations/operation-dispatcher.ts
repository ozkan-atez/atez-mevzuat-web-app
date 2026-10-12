import { Prisma, type PrismaClient } from '@prisma/client'
import { operationQueueName, type RabbitQueue } from '../../platform/rabbitmq'
/** Claim and route only runnable commands; failed dependency tasks never masquerade as success. */
export async function dispatchOperations(prisma: PrismaClient, queue: Pick<RabbitQueue,'send'>) {
  // A crashed business worker may have an expired lease but an already delivered outbox.
  // Re-publish through a fresh durable command; task fencing makes duplicates harmless.
  await prisma.$transaction(async tx => {
    const stalled = await tx.operationTask.findMany({where:{status:'RUNNING',leaseUntil:{lt:new Date()}},take:20})
    for(const task of stalled) {
      const reset = await tx.operationTask.updateMany({where:{id:task.id,status:'RUNNING',leaseOwner:task.leaseOwner,leaseUntil:{lt:new Date()}},data:{status:'QUEUED',leaseOwner:null,leaseUntil:null}})
      if(reset.count) await tx.operationOutbox.create({data:{taskId:task.id}})
    }
  })
  const rows = await prisma.$queryRaw<Array<{id:string;taskId:string;attempts:number}>>(Prisma.sql`
    UPDATE "OperationOutbox" SET "status"='DISPATCHING', "leaseUntil"=NOW()+INTERVAL '60 seconds', "attempts"="attempts"+1
    WHERE "id" IN (SELECT o."id" FROM "OperationOutbox" o JOIN "OperationTask" t ON t."id"=o."taskId"
      WHERE (o."status"='PENDING' OR (o."status"='DISPATCHING' AND o."leaseUntil"<NOW()))
      AND o."availableAt"<=NOW() AND t."status"='QUEUED'
      AND NOT EXISTS (SELECT 1 FROM "OperationTask" dep WHERE dep."id"=ANY(t."dependencyIds") AND dep."status" IN ('QUEUED','RUNNING','WAITING_INPUT'))
      ORDER BY o."createdAt" LIMIT 20 FOR UPDATE OF o SKIP LOCKED)
    RETURNING "id", "taskId", "attempts"`)
  for(const row of rows) {
    try {
      await queue.send(operationQueueName,{taskId:row.taskId},{singletonKey:row.id})
      await prisma.operationOutbox.updateMany({where:{id:row.id,status:'DISPATCHING',attempts:row.attempts},data:{status:'DISPATCHED',dispatchedAt:new Date(),leaseUntil:null,errorMessage:null}})
    } catch(error) {
      await prisma.operationOutbox.updateMany({where:{id:row.id,status:'DISPATCHING',attempts:row.attempts},data:{status:'PENDING',leaseUntil:null,availableAt:new Date(Date.now()+Math.min(60_000,1000*2**row.attempts)),errorMessage:error instanceof Error?error.message:'Queue dispatch failed'}})
    }
  }
}
