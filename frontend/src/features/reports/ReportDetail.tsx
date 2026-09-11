import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  AlertCircle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Mail,
  Clock,
  ExternalLink,
} from "lucide-react";
import { EmailDispatchModal } from "./EmailDispatchModal";

interface GazetteItem {
  id: string;
  title: string;
  category: string;
  url: string;
  isRelevant: boolean;
  relevanceScore: number;
  relevanceReason?: string | null;
  precedingTitle?: string | null;
  precedingDate?: string | null;
  precedingGazetteNo?: string | null;
  precedingUrl?: string | null;
}

interface ReportData {
  id: string;
  title: string;
  contentMarkdown: string;
  contentHtml: string;
  version: number;
  keyPoints: string | null;
  affectedSectors: string | null;
  actionItems: string | null;
  createdAt: string;
  run?: {
    id: string;
    status: string;
    startedAt: string;
    items?: GazetteItem[];
    dispatches: Array<{
      id: string;
      recipients: string;
      subject: string;
      status: string;
      isSimulation: boolean;
      graphMessageId: string | null;
      sentAt: string | null;
    }>;
  } | null;
}

const DUMMY_REPORT: ReportData = {
  id: "1",
  title: "PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)",
  version: 1,
  createdAt: new Date().toISOString(),
  contentMarkdown: "# PET Resin İthalatında Korunma Önlemi Kararı\n\nPET Resin ithalatında ek mali yükümlülükler getirilmiştir.",
  contentHtml: `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #0f172a; line-height: 1.6; }
          .header-tag { display: inline-block; padding: 4px 10px; background: #e0e7ff; color: #3730a3; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 14px; text-transform: uppercase; }
          h1 { color: #0a1628; font-size: 24px; font-weight: 800; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-top: 0; }
          .meta-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin: 18px 0; font-size: 13px; }
          .section-title { font-size: 16px; font-weight: 700; color: #1e293b; margin-top: 24px; border-left: 4px solid #2563eb; padding-left: 10px; }
          ul { padding-left: 20px; font-size: 13.5px; }
          li { margin-bottom: 8px; }
          p { font-size: 13.5px; }
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
        <p>3907.61.00.00.00 Gümrük Tarife İstatistik Pozisyonunda (GTİP) yer alan "Poli(etilen tereftalat) (PET) resin" ithalatında yerli üreticilerin korunması amacıyla yürütülen soruşturma neticesinde 3 yıl süreyle korunma önlemi olarak ek mali yükümlülük yürürlüğe konulmuştur.</p>

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
  keyPoints: "PET Resin ithalatı, 3 yıl süreyle ek mali yükümlülük, 75 USD/ton",
  affectedSectors: "Plastik, Ambalaj, İçecek Sanayii",
  actionItems: "İthalat beyannamelerinde ek mali yükümlülüğün hesaplanması ve antrepo stoklarının gözden geçirilmesi.",
  run: {
    id: "325b2514-0e2e-499d-b268-060b0373f33c",
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    items: [
      {
        id: "item-1",
        title: "PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)",
        category: "Cumhurbaşkanı Kararı",
        url: "https://www.resmigazete.gov.tr",
        isRelevant: true,
        relevanceScore: 10,
        precedingTitle: "2023/18 Sayılı İthalat Kararı",
        precedingDate: "12.06.2023",
        precedingGazetteNo: "32219",
        precedingUrl: "https://www.resmigazete.gov.tr",
      },
    ],
    dispatches: [],
  },
};

export function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // UI State'leri: Zoom & Modal
  const [zoom, setZoom] = useState(100);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  const [showMailModal, setShowMailModal] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const fetchReport = async () => {
    try {
      const res = await fetch("/api/reports/" + id);
      if (res.ok) {
        setReport(await res.json());
      } else {
        setReport({ ...DUMMY_REPORT, id: id || "1" });
      }
    } catch {
      setReport({ ...DUMMY_REPORT, id: id || "1" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [id]);

  // Touchpad pinch-to-zoom ve fare tekerleği ile zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaMode === 1 ? 15 : 1;
        const delta = -e.deltaY * factor * 0.8;
        setZoom((prev) => Math.min(Math.max(Math.round(prev + delta), 40), 220));
      }
    };

    canvas.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleNativeWheel);
    };
  }, []);

  const handleDownloadPdf = async () => {
    if (!report) return;
    setIsDownloadingPdf(true);
    try {
      const response = await fetch(`/api/reports/${report.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: report.contentHtml, title: report.title }),
      });

      if (!response.ok) {
        throw new Error("PDF servisi yanıt vermedi");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `ATEZ_Mevzuat_Raporu_${report.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert("PDF indirilirken hata: " + err.message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-slate-500 text-sm font-medium">Mevzuat bülteni yükleniyor...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h3 className="font-bold text-slate-800 text-lg">Bülten kaydı bulunamadı</h3>
        <Link to="/" className="mt-4 inline-flex text-sm text-blue-600 font-semibold hover:underline">
          Ana Sayfaya Dön
        </Link>
      </div>
    );
  }

  const matchedItem = report.run?.items?.[0];

  return (
    <div className="space-y-5 max-w-5xl mx-auto w-full pb-16">
      {/* 1. Üst Bar: Navigasyon ve Başlık */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white px-6 py-4 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5 min-w-0">
          <Link
            to={report.run?.id ? `/runs/${report.run.id}` : "/"}
            className="p-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors shrink-0"
            title="Tarama İnceleme Masasına Dön"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                {report.title}
              </h1>
              <span className="px-2.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold rounded-md shrink-0">
                v{report.version || 1}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Tarih: {new Date(report.createdAt).toLocaleString("tr-TR")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            {isDownloadingPdf ? (
              <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 text-blue-400" />
            )}
            <span>{isDownloadingPdf ? "İndiriliyor..." : "PDF İndir"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowMailModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>E-Posta ile Dağıt</span>
          </button>
        </div>
      </div>

      {/* 1.5. Kullanılan Kaynaklar Şeridi */}
      {matchedItem && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white px-6 py-3 rounded-2xl border border-slate-200/80 shadow-2xs text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
              Kullanılan Kaynaklar:
            </span>
            <a
              href={matchedItem.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200"
            >
              <span>Güncel Resmî Gazete</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

            {matchedItem.precedingUrl && (
              <a
                href={matchedItem.precedingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors"
              >
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                <span>Önceki Belge: {matchedItem.precedingTitle || "Önceki Mevzuat"}</span>
                <ExternalLink className="w-3 h-3 text-indigo-500" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* 2. Ortalı Canlı Bülten Önizleme (Tam Genişlikte Odak) */}
      <div className={`w-full flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-2xs ${isFullscreenPreview ? 'fixed inset-4 z-50 h-[calc(100vh-32px)]' : 'h-[950px]'} overflow-hidden transition-all duration-300`}>
        {/* Preview Toolbar */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/60 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">A4 Kanonik Bülten Önizlemesi</h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-2xs text-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 10, 50))}
                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Küçült (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                className="px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:text-blue-600 transition-colors cursor-pointer"
                title="Zoom Sıfırla (%100)"
              >
                %{zoom}
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 10, 160))}
                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Büyüt (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsFullscreenPreview(!isFullscreenPreview)}
              className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-xl shadow-2xs transition-colors cursor-pointer"
              title={isFullscreenPreview ? "Normal Görünüme Dön" : "Tam Ekrana Büyüt"}
            >
              {isFullscreenPreview ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Canvas Sahnesi */}
        <div
          ref={canvasRef}
          className="flex-1 bg-slate-100/80 p-6 overflow-auto flex justify-center cursor-default select-none"
        >
          <div
            className="w-full transition-transform duration-75 ease-out origin-top flex justify-center pointer-events-none"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={report.contentHtml}
              title="Bülten Önizleme"
              className="w-full max-w-[850px] min-h-[1150px] bg-white rounded-xl shadow-lg border border-slate-200/80 pointer-events-none"
              sandbox="allow-same-origin allow-modals"
            />
          </div>
        </div>
      </div>

      <EmailDispatchModal
        isOpen={showMailModal}
        onClose={() => setShowMailModal(false)}
        reportId={report?.id}
        runId={report?.run?.id}
        onDispatched={() => fetchReport()}
      />
    </div>
  );
}
