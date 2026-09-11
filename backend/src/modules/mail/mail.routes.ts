import { FastifyInstance } from 'fastify';
import { prisma } from '../../platform/database';

export async function mailRoutes(fastify: FastifyInstance) {
  // 1. Müşteri/Departman Grupları CRUD
  fastify.get('/customer-groups', async (_request, reply) => {
    const groups = await prisma.customerGroup.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(groups);
  });

  fastify.post('/customer-groups', async (request, reply) => {
    const { name, description, emails } = request.body as {
      name: string;
      description?: string;
      emails: string;
    };

    const created = await prisma.customerGroup.create({
      data: {
        name,
        description: description || null,
        emails,
        isActive: true,
      },
    });
    return reply.status(201).send(created);
  });

  fastify.put('/customer-groups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, description, emails } = request.body as {
      name: string;
      description?: string;
      emails: string;
    };

    const updated = await prisma.customerGroup.update({
      where: { id },
      data: { name, description, emails },
    });
    return reply.send(updated);
  });

  fastify.delete('/customer-groups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.customerGroup.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // 2. E-Posta Önizleme (Taslak)
  fastify.post('/mail/preview', async (request, reply) => {
    const { reportId, runId } = request.body as { reportId?: string; runId?: string };

    let reportTitle = 'Resmi Gazete Gümrük ve Dış Ticaret Mevzuat Bülteni';
    let subject = 'T.C. Resmî Gazete Gümrük ve Dış Ticaret Mevzuat Bülteni';

    if (reportId) {
      const report = await prisma.report.findUnique({ where: { id: reportId } });
      if (report) {
        reportTitle = report.title;
        subject = `ATEZ Mevzuat Bülteni: ${report.title}`;
      }
    }

    const groups = await prisma.customerGroup.findMany({ where: { isActive: true } });
    const defaultEmails = groups.flatMap((g: { emails: string }) => g.emails.split(',').map((e: string) => e.trim()));

    return reply.send({
      from: 'atezmevzuat@gmail.com',
      fromName: 'ATEZ Gümrük & Mevzuat Radarı',
      reportTitle,
      subject,
      plainTextMessage: `Sayın İlgili,\n\n${reportTitle} hakkında hazırlanan yapay zeka destekli mevzuat ve etki analizi bülteni ekte bilgilerinize sunulmuştur.\n\nSaygılarımızla,\nATEZ Mevzuat Radarı`,
      pdfFileName: `${reportTitle.slice(0, 40).replace(/[^a-zA-Z0-9_\-]/g, '_')}.pdf`,
      defaultTo: Array.from(new Set(defaultEmails)),
    });
  });

  // 3. E-Posta Gönderme / Simülasyon
  fastify.post('/mail/send', async (request, reply) => {
    const { reportId, runId, to, subject, messageText } = request.body as {
      reportId?: string;
      runId?: string;
      to: string[];
      subject: string;
      messageText: string;
    };

    const recipientsStr = to.join(', ');

    // Veritabanına dağıtım kaydı oluştur
    const dispatch = await prisma.emailDispatch.create({
      data: {
        runId: runId || null,
        recipients: recipientsStr,
        subject,
        status: 'SENT',
        isSimulation: true,
        sentAt: new Date(),
      },
    });

    return reply.send({
      success: true,
      isSimulation: true,
      messageId: dispatch.id,
      note: 'Bülten ve PDF eki simüle edildi ve e-posta dağıtım günlüğüne başarıyla kaydedildi.',
    });
  });
}
