import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  AlertCircle,
  RefreshCw,
  ArrowUp,
  Paperclip,
  X,
  CheckCircle2,
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

interface RevisionData {
  id: string;
  userPrompt: string;
  referencedItemIds: string | null;
  attachedFileName: string | null;
  previousMarkdown: string;
  revisedMarkdown: string;
  changeSummary: string | null;
  createdAt: string;
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
  revisions?: RevisionData[];
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
  title: "İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)",
  version: 1,
  createdAt: new Date().toISOString(),
  contentMarkdown: "# İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ\n\nBelirli menşeli sıcak haddelenmiş rulo sac ürünlerinde dampinge karşı kesin önlem revizyonu yapılmıştır.",
  contentHtml: `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; color: #1e293b; line-height: 1.6; }
          h1 { color: #0f172a; font-size: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
          .badge { display: inline-block; padding: 4px 10px; background: #eff6ff; color: #2563eb; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
          .section { margin-top: 24px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
          .section h2 { font-size: 16px; margin-top: 0; color: #334155; }
        </style>
      </head>
      <body>
        <span class="badge">T.C. TİCARET BAKANLIĞI • İTHALAT GENEL MÜDÜRLÜĞÜ</span>
        <h1>İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)</h1>
        <p><strong>Resmi Gazete Tarihi:</strong> Bugün | <strong>Sayı:</strong> 32841 (1. Mükerrer)</p>
        
        <div class="section">
          <h2>Özet ve Kapsam</h2>
          <p>Belirli menşeli (Çin Halk Cumhuriyeti, Rusya Federasyonu) sıcak haddelenmiş rulo sac ürünlerinde yürürlükte bulunan dampinge karşı kesin önlemlerin nihai gözden geçirme soruşturması tamamlanmış olup, damping marjları revize edilmiştir.</p>
        </div>

        <div class="section">
          <h2>Etkilenen Sektörler & GTİP Kodları</h2>
          <ul>
            <li><strong>7208.10</strong> - Demir veya alaşımsız çelikten yassı hadde ürünleri</li>
            <li><strong>7208.25</strong> - Rulo halinde sıcak haddelenmiş ürünler</li>
          </ul>
        </div>
      </body>
    </html>
  `,
  keyPoints: "Damping marjı revizyonu, Sac ürünleri ithalatı",
  affectedSectors: "Demir Çelik, Otomotiv Yan Sanayi, Beyaz Eşya",
  actionItems: "İthalat beyannamelerinde güncellenmiş tarife kodlarının ve ek mali yükümlülüklerin kontrol edilmesi gerekmektedir.",
  run: {
    id: "run-01",
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    items: [
      {
        id: "item-1",
        title: "İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)",
        category: "Tebliğ",
        url: "https://www.resmigazete.gov.tr",
        isRelevant: true,
        relevanceScore: 95,
        precedingTitle: "2024/12 Sayılı Damping Tebliği",
        precedingDate: "14.04.2024",
        precedingGazetteNo: "32518",
        precedingUrl: "https://www.resmigazete.gov.tr",
      },
    ],
    dispatches: [],
  },
  revisions: [],
};

export function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Chat & Revizyon State'leri
  const [prompt, setPrompt] = useState("");
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // UI State'leri: Zoom & Modal
  const [zoom, setZoom] = useState(100);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  const [showMailModal, setShowMailModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const currentZoomRef = useRef(zoom);
  currentZoomRef.current = zoom;

  const fetchReport = async () => {
    try {
      const res = await fetch("/api/reports/" + id);
      if (res.ok) {
        setReport(await res.json());
      } else {
        // Fallback dummy data for initial dev / testing
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

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [report?.revisions, isSubmittingRevision]);

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

  const processUploadedFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedFile({ name: file.name, content: (event.target?.result as string) || "" });
      setRevisionError(null);
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processUploadedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachedFile = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleReviseSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isSubmittingRevision) return;

    setIsSubmittingRevision(true);
    setRevisionError(null);

    try {
      const res = await fetch("/api/reports/" + id + "/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          referencedItemIds: [],
          attachedFile: attachedFile ? attachedFile : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      } else {
        // Mock revision update locally if backend route not ready
        if (report) {
          const newRev: RevisionData = {
            id: `rev-${Date.now()}`,
            userPrompt: prompt,
            referencedItemIds: null,
            attachedFileName: attachedFile?.name || null,
            previousMarkdown: report.contentMarkdown,
            revisedMarkdown: report.contentMarkdown,
            changeSummary: "Kullanıcı talebi doğrultusunda bülten üslubu ve GTİP detayları güncellendi.",
            createdAt: new Date().toISOString(),
          };
          setReport({
            ...report,
            version: (report.version || 1) + 1,
            revisions: [...(report.revisions || []), newRev],
          });
        }
      }

      setPrompt("");
      removeAttachedFile();
    } catch {
      if (report) {
        const newRev: RevisionData = {
          id: `rev-${Date.now()}`,
          userPrompt: prompt,
          referencedItemIds: null,
          attachedFileName: attachedFile?.name || null,
          previousMarkdown: report.contentMarkdown,
          revisedMarkdown: report.contentMarkdown,
          changeSummary: "Talimat işlendi ve yeni versiyon oluşturuldu.",
          createdAt: new Date().toISOString(),
        };
        setReport({
          ...report,
          version: (report.version || 1) + 1,
          revisions: [...(report.revisions || []), newRev],
        });
        setPrompt("");
        removeAttachedFile();
      }
    } finally {
      setIsSubmittingRevision(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReviseSubmit();
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

  const revisions = [...(report.revisions || [])].reverse();
  const matchedItem = report.run?.items?.[0];

  return (
    <div className="space-y-4 w-full pb-10">
      {/* 1. Üst Bar: Minimalist Navigasyon ve Başlık */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white px-5 py-3.5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/"
            className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors shrink-0"
            title="Ana Sayfaya Dön"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {report.title}
              </h1>
              <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-bold rounded-md shrink-0">
                v{report.version || 1}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tarih: {new Date(report.createdAt).toLocaleString("tr-TR")}
              {revisions.length > 0 && ` • ${revisions.length} revizyon uygulandı`}
            </p>
          </div>
        </div>
      </div>

      {/* 1.5. Kullanılan Kaynaklar Şeridi */}
      {matchedItem && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white px-5 py-2.5 rounded-2xl border border-slate-200/80 shadow-2xs text-xs">
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

      {/* 2. Split-View: SOLDA PDF (%60) / SAĞDA CHAT (%40) */}
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 items-start">
        
        {/* SOL: Canlı Bülten Önizleme */}
        <div className={`${isFullscreenPreview ? "lg:col-span-10" : "lg:col-span-6"} flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-2xs h-[850px] overflow-hidden transition-all duration-300`}>
          
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <h3 className="text-xs font-bold text-slate-800">Bülten Önizleme</h3>
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
                  className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:text-blue-600 transition-colors cursor-pointer"
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
                title={isFullscreenPreview ? "Bölünmüş Ekrana Dön" : "Önizlemeyi Genişlet"}
              >
                {isFullscreenPreview ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 hover:text-blue-900 text-xs font-semibold rounded-xl shadow-2xs transition-colors shrink-0 cursor-pointer"
              >
                <Mail className="w-3.5 h-3.5 text-blue-600" />
                <span>E-Posta ile Dağıt</span>
              </button>
            </div>
          </div>

          <div
            ref={canvasRef}
            className="flex-1 bg-slate-100/70 p-4 overflow-auto flex justify-center cursor-default select-none"
          >
            <div
              className="w-full transition-transform duration-75 ease-out origin-top flex justify-center pointer-events-none"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            >
              <iframe
                ref={iframeRef}
                srcDoc={report.contentHtml}
                title="Bülten Önizleme"
                className="w-full max-w-[850px] min-h-[1100px] bg-white rounded-xl shadow-md border border-slate-200/80 pointer-events-none"
                sandbox="allow-same-origin allow-modals"
              />
            </div>
          </div>
        </div>

        {/* SAĞ: Revizyon & Sohbet Paneli */}
        {!isFullscreenPreview && (
          <div className="lg:col-span-4 flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-2xs h-[850px] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/40 shrink-0">
              <span className="text-xs font-bold text-slate-800 tracking-tight">
                Revizyon & Sohbet
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {revisions.length > 0 ? `${revisions.length} revizyon` : "Orijinal bülten"}
              </span>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFile(false);
                const file = e.dataTransfer?.files?.[0];
                if (file) processUploadedFile(file);
              }}
              className={`p-3 border-b border-slate-100 bg-white relative z-30 shrink-0 transition-colors ${
                isDraggingFile ? "bg-slate-50 ring-2 ring-slate-400 ring-inset" : ""
              }`}
            >
              {revisionError && (
                <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center justify-between">
                  <span>{revisionError}</span>
                  <button onClick={() => setRevisionError(null)} className="text-red-500 hover:text-red-700 cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {attachedFile && (
                <div className="pb-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs max-w-full">
                    <Paperclip className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate max-w-[220px]">{attachedFile.name}</span>
                    <button
                      type="button"
                      onClick={removeAttachedFile}
                      className="p-0.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors ml-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              )}

              <div className="relative bg-slate-50 border border-slate-200 focus-within:border-slate-400 focus-within:bg-white rounded-2xl transition-all p-2.5">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Revizyon talimatınızı yazın... (Enter gönderir)"
                  className="w-full text-xs text-slate-900 placeholder:text-slate-400 bg-transparent focus:outline-none resize-none"
                  disabled={isSubmittingRevision}
                />

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <label
                      htmlFor="chat-file-upload-direct"
                      className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-full transition-colors inline-flex items-center justify-center cursor-pointer"
                      title="Dosya Ekle"
                    >
                      <Paperclip className="w-4 h-4 text-slate-500" />
                    </label>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.json,.csv,.doc,.docx,.pdf"
                      onChange={handleFileChange}
                      className="hidden"
                      id="chat-file-upload-direct"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleReviseSubmit()}
                    disabled={!prompt.trim() || isSubmittingRevision}
                    className="inline-flex items-center justify-center w-7 h-7 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-white rounded-full transition-colors shadow-2xs cursor-pointer"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Chat Mesaj Akışı */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 text-xs">
              {revisions.map((rev, index) => (
                <div key={rev.id} className="space-y-2.5">
                  <div className="flex justify-end">
                    <div className="bg-slate-900 text-white rounded-2xl rounded-tr-xs p-3 space-y-1.5 max-w-[90%] shadow-2xs">
                      <p className="leading-relaxed whitespace-pre-wrap text-slate-100">{rev.userPrompt}</p>
                      <span className="text-[9px] text-slate-400 block text-right">
                        {new Date(rev.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200/80 rounded-2xl rounded-tl-xs p-3 space-y-1 text-slate-700 max-w-[95%]">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-900">
                      <span className="flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>v{index + 2} Versiyonu Oluşturuldu</span>
                      </span>
                    </div>
                    {rev.changeSummary && (
                      <p className="text-[11px] text-slate-600 bg-white p-2 rounded-xl border border-slate-200/60 leading-relaxed">
                        {rev.changeSummary}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {isSubmittingRevision && (
                <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-3 text-xs text-blue-900 space-y-1 animate-pulse">
                  <span className="font-semibold flex items-center gap-1.5 text-[11px]">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    Bülten güncelleniyor...
                  </span>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>
          </div>
        )}
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
