import { FastifyInstance } from 'fastify';
import { prisma } from '../../platform/database';
import { generatePdfFromHtml } from '../../platform/pdf';

export async function reportsRoutes(fastify: FastifyInstance) {
  // Rapor detayını getir
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        revisions: { orderBy: { createdAt: 'desc' } },
        run: {
          include: {
            items: { where: { isRelevant: true } },
            dispatches: true,
          },
        },
      },
    });

    if (!report) {
      return reply.status(404).send({ error: 'Rapor bulunamadı' });
    }

    return reply.send(report);
  });

  // Gotenberg üzerinden canlı PDF üret ve döndür
  fastify.post('/:id/pdf', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { html?: string; title?: string } | undefined;

    let htmlContent = body?.html;

    if (!htmlContent) {
      const report = await prisma.report.findUnique({ where: { id } });
      if (!report || !report.contentHtml) {
        return reply.status(404).send({ error: 'Rapor HTML içeriği bulunamadı' });
      }
      htmlContent = report.contentHtml;
    }

    try {
      const pdfBuffer = await generatePdfFromHtml(htmlContent);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="Rapor_${id}.pdf"`)
        .send(pdfBuffer);
    } catch (err: any) {
      request.log.error(err, 'PDF oluşturulamadı');
      return reply.status(500).send({ error: 'PDF oluşturulamadı: ' + err.message });
    }
  });

  // Rapor üzerinde chat tabanlı revizyon oluştur
  fastify.post('/:id/revise', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { prompt, attachedFile } = request.body as {
      prompt: string;
      attachedFile?: { name: string; content: string };
    };

    const currentReport = await prisma.report.findUnique({ where: { id } });
    if (!currentReport) {
      return reply.status(404).send({ error: 'Revize edilecek rapor bulunamadı' });
    }

    // Revizyon kaydını oluştur
    const newVersion = currentReport.version + 1;
    const changeSummary = `Talimat işlendi: "${prompt.slice(0, 80)}..." doğrultusunda içerik ve analiz güncellendi.`;

    const revision = await prisma.reportRevision.create({
      data: {
        reportId: currentReport.id,
        userPrompt: prompt,
        changeSummary,
        previousData: currentReport.contentMarkdown || '',
        revisedData: currentReport.contentMarkdown || '',
      },
    });

    const updatedReport = await prisma.report.update({
      where: { id },
      data: {
        version: newVersion,
        status: 'REVISED',
      },
      include: {
        revisions: { orderBy: { createdAt: 'desc' } },
        run: {
          include: {
            items: { where: { isRelevant: true } },
            dispatches: true,
          },
        },
      },
    });

    return reply.send({ report: updatedReport, revision });
  });
}
