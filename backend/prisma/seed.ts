import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Gerçekçi veritabanı tohumlaması (Seed) başlatılıyor...');

  // 1. Temel Kullanıcı
  const user = await prisma.user.upsert({
    where: { email: 'admin@atez.com' },
    update: {},
    create: {
      email: 'admin@atez.com',
      name: 'ATEZ Admin',
      role: 'ADMIN',
      isActive: true,
    },
  });

  // 2. Müşteri & Departman Grupları
  await prisma.customerGroup.createMany({
    data: [
      {
        name: 'Yönetim Kurulu & Direktörler',
        description: 'Tüm kritik mevzuat bültenleri anlık olarak iletilir.',
        emails: 'genel-mudur@atez.com, yonetim@atez.com',
        isActive: true,
      },
      {
        name: 'Gümrük Operasyon Ekibi',
        description: 'Tarife ve GTİP değişiklikleri, damping kararları.',
        emails: 'gumruk-operasyon@atez.com, mevzuat-takip@atez.com',
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  // 3. İş Akışı Tanımı
  const workflow = await prisma.workflow.upsert({
    where: { key: 'resmi-gazete-gumruk' },
    update: {},
    create: {
      key: 'resmi-gazete-gumruk',
      name: 'Resmi Gazete Gümrük & Dış Ticaret Takip Otomasyonu',
      description: 'Günlük T.C. Resmi Gazete gümrük ve dış ticaret mevzuat değişikliklerini analiz eden otonom ajan zinciri.',
      cron: '0 4,9,14,22 * * *',
      isActive: true,
    },
  });

  // 4. Örnek Canlı Tarama Görevi (325b2514-0e2e-499d-b268-060b0373f33c)
  const runId = '325b2514-0e2e-499d-b268-060b0373f33c';
  
  // Önce varsa eski seed kaydını temizleyelim
  await prisma.workflowRun.deleteMany({ where: { id: runId } });

  const run = await prisma.workflowRun.create({
    data: {
      id: runId,
      workflowId: workflow.id,
      status: 'COMPLETED',
      parameters: JSON.stringify({ targetDate: '2026-07-11', mode: 'FULL', triggeredBy: 'CRON_JOB' }),
      summary: '62 mevzuat incelendi, 39 gümrük maddesi belirlendi.',
      startedAt: new Date(Date.now() - 3600000),
      finishedAt: new Date(Date.now() - 3400000),
    },
  });

  // Ajan Adımları (Logs)
  await prisma.agentTaskLog.createMany({
    data: [
      {
        runId: run.id,
        agentName: 'GazetteScraper',
        stepName: 'Resmî Gazete Fihristi ve İçeriklerinin Taranması',
        status: 'COMPLETED',
        durationMs: 3400,
        inputData: JSON.stringify({ targetDate: '2026-07-11' }),
        outputData: JSON.stringify({ count: 62 }),
        createdAt: new Date(Date.now() - 3590000),
      },
      {
        runId: run.id,
        agentName: 'CustomsFilterAgent',
        stepName: 'Gümrük ve Dış Ticaret Maddelerinin Yapay Zeka ile Filtrelenmesi',
        status: 'COMPLETED',
        durationMs: 7200,
        inputData: JSON.stringify({ totalItems: 62 }),
        outputData: JSON.stringify({ relevantCount: 39, totalEvaluated: 62 }),
        createdAt: new Date(Date.now() - 3550000),
      },
      {
        runId: run.id,
        agentName: 'CustomsAnalysisAgent',
        stepName: 'Seçilen Maddelerin Yasal, Operasyonel ve Maliyet Etki Analizi',
        status: 'COMPLETED',
        durationMs: 14500,
        inputData: JSON.stringify({ relevantItemCount: 39 }),
        outputData: JSON.stringify({ totalRelevantItems: 39 }),
        createdAt: new Date(Date.now() - 3480000),
      },
      {
        runId: run.id,
        agentName: 'ReportGeneratorAgent',
        stepName: 'Her Bir Değişiklik İçin Bağımsız ATEZ Mevzuat Raporlarının Üretimi',
        status: 'COMPLETED',
        durationMs: 18000,
        inputData: JSON.stringify({ itemCount: 39 }),
        outputData: JSON.stringify({ reportsCreated: 6 }),
        createdAt: new Date(Date.now() - 3450000),
      },
      {
        runId: run.id,
        agentName: 'NotificationAgent',
        stepName: 'Microsoft Graph API ile E-Posta Dağıtım Hazırlığı',
        status: 'COMPLETED',
        durationMs: 1200,
        inputData: null,
        outputData: JSON.stringify({ isSimulation: true }),
        createdAt: new Date(Date.now() - 3410000),
      },
    ],
  });

  // Taranan Resmî Gazete Maddeleri
  await prisma.gazetteItem.createMany({
    data: [
      {
        runId: run.id,
        date: '2026-07-11',
        title: 'PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)',
        category: 'Cumhurbaşkanı Kararı',
        url: 'https://www.resmigazete.gov.tr',
        isRelevant: true,
        relevanceScore: 10,
        relevanceReason: 'PET Resin ithalatına getirilen korunma önlemi, belirli bir ürün grubu için ek mali yükümlülük veya kota anlamına gelir.',
        precedingTitle: '2023/18 Sayılı İthalat Kararı',
        precedingDate: '12.06.2023',
        precedingGazetteNo: '32219',
        precedingUrl: 'https://www.resmigazete.gov.tr',
      },
      {
        runId: run.id,
        date: '2026-07-11',
        title: 'İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)',
        category: 'Tebliğ',
        url: 'https://www.resmigazete.gov.tr',
        isRelevant: true,
        relevanceScore: 9,
        relevanceReason: 'Sıcak haddelenmiş rulo sac ürünlerinde dampinge karşı kesin önlem marjları revize edilmiştir.',
      },
      {
        runId: run.id,
        date: '2026-07-11',
        title: 'Gümrük Genel Tebliği (Seri No: 198) Değişikliği',
        category: 'Tebliğ',
        url: 'https://www.resmigazete.gov.tr',
        isRelevant: true,
        relevanceScore: 8,
        relevanceReason: 'Yetkilendirilmiş Yükümlü Statüsü (YYS) sahiplerinin yıllık raporlama beyan süre uzatımı.',
      },
      {
        runId: run.id,
        date: '2026-07-11',
        title: 'Bazı Tekstil ve Konfeksiyon Ürünlerinin İthalatında Tarife Kontenjanı',
        category: 'Tebliğ',
        url: 'https://www.resmigazete.gov.tr',
        isRelevant: true,
        relevanceScore: 8,
        relevanceReason: 'Avrupa Birliği menşeli olmayan pamuk ipliklerinde gümrük vergisi muafiyet kotaları.',
      },
    ],
  });

  // Üretilen Raporlar
  const report1 = await prisma.report.create({
    data: {
      id: '1',
      runId: run.id,
      title: 'PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)',
      status: 'APPROVED',
      version: 1,
      contentMarkdown: '# PET Resin İthalatında Korunma Önlemi Kararı\n\nPET Resin ithalatında ek mali yükümlülükler getirilmiştir.',
      contentHtml: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; padding: 36px; color: #0f172a; line-height: 1.6; }
              .header-tag { display: inline-block; padding: 4px 10px; background: #e0e7ff; color: #3730a3; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 14px; text-transform: uppercase; }
              h1 { color: #0a1628; font-size: 22px; font-weight: 800; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-top: 0; }
              .meta-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin: 18px 0; font-size: 13px; }
              .section-title { font-size: 15px; font-weight: 700; color: #1e293b; margin-top: 24px; border-left: 3px solid #2563eb; padding-left: 8px; }
              ul { padding-left: 20px; font-size: 13px; }
              li { margin-bottom: 6px; }
            </style>
          </head>
          <body>
            <span class="header-tag">T.C. TİCARET BAKANLIĞI • İTHALAT GENEL MÜDÜRLÜĞÜ</span>
            <h1>PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)</h1>
            
            <div class="meta-box">
              <p><strong>Yayım Tarihi:</strong> 11 Temmuz 2026 | <strong>Resmî Gazete Sayısı:</strong> 32841</p>
              <p><strong>Öncelik Seviyesi:</strong> <span style="color: #dc2626; font-weight: 700;">YÜKSEK (10/10)</span> • Doğrudan Ek Mali Yükümlülük</p>
            </div>

            <div class="section-title">1. Kararın Özeti ve Kapsamı</div>
            <p style="font-size: 13px;">3907.61.00.00.00 Gümrük Tarife İstatistik Pozisyonunda (GTİP) yer alan "Poli(etilen tereftalat) (PET) resin" ithalatında yerli üreticilerin korunması amacıyla yürütülen soruşturma neticesinde 3 yıl süreyle korunma önlemi olarak ek mali yükümlülük yürürlüğe konulmuştur.</p>

            <div class="section-title">2. Uygulanacak Ek Mali Yükümlülük Tarifesi</div>
            <ul>
              <li><strong>1. Yıl:</strong> 75 ABD Doları / Ton</li>
              <li><strong>2. Yıl:</strong> 70 ABD Doları / Ton</li>
              <li><strong>3. Yıl:</strong> 65 ABD Doları / Ton</li>
            </ul>

            <div class="section-title">3. Şirketimiz ve Müşteriler İçin Aksiyon Planı</div>
            <ul>
              <li>Plastik ambalaj ve preform üretimi yapan müşterilerimizin ithalat maliyet bütçelerinin revize edilmesi.</li>
              <li>Gelişmekte olan ülkeler için tanınan tarife kontenjanı muafiyet şartlarının menşe belgeleri üzerinden teyidi.</li>
            </ul>
          </body>
        </html>
      `,
      keyPoints: 'PET Resin ithalatı, 3 yıl süreyle ek mali yükümlülük, 75 USD/ton',
      affectedSectors: 'Plastik, Ambalaj, İçecek Sanayii',
      actionItems: 'İthalat beyannamelerinde ek mali yükümlülüğün hesaplanması ve antrepo stoklarının gözden geçirilmesi.',
    },
  });

  console.log(`✅ Veritabanı başarıyla tohumlandı! Run ID: ${run.id}, Rapor ID: ${report1.id}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
