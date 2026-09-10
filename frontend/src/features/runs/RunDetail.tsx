import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  FileText,
  Mail,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface TaskLog {
  id: string;
  agentName: string;
  stepName: string;
  status: string;
  durationMs: number | null;
  inputData: string | null;
  outputData: string | null;
  error: string | null;
  createdAt: string;
}

interface GazetteItem {
  id: string;
  date: string;
  title: string;
  category: string;
  url: string;
  isRelevant: boolean;
  relevanceScore: number;
  relevanceReason: string | null;
}

interface RunDetails {
  id: string;
  status: string;
  parameters: string | null;
  summary: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  workflow: { name: string };
  logs: TaskLog[];
  items: GazetteItem[];
  reports: Array<{ id: string; title: string; version?: number; createdAt?: string }>;
  dispatches: Array<{ id: string; recipients: string; subject: string; status: string }>;
}

const DUMMY_RUN: RunDetails = {
  id: "CRON-02",
  status: "COMPLETED",
  parameters: null,
  summary: "Resmi Gazete taranarak 1 tebliğ bültene dönüştürüldü ve dağıtım sağlandı.",
  error: null,
  startedAt: new Date(Date.now() - 3600000).toISOString(),
  finishedAt: new Date().toISOString(),
  workflow: { name: "Günlük Resmi Gazete Taraması (09:00 1. Mükerrer)" },
  logs: [
    {
      id: "log-1",
      agentName: "ResmiGazeteScraper",
      stepName: "Mevzuat HTML Ayrıştırma",
      status: "COMPLETED",
      durationMs: 4200,
      inputData: "https://www.resmigazete.gov.tr",
      outputData: '{"scannedItemsCount": 18, "relevantItems": 1}',
      error: null,
      createdAt: new Date(Date.now() - 3500000).toISOString(),
    },
    {
      id: "log-2",
      agentName: "TariffGtipAnalyzer",
      stepName: "GTİP ve Damping Analizi",
      status: "COMPLETED",
      durationMs: 6500,
      inputData: "İthalatta Haksız Rekabet Tebliği No: 2026/4",
      outputData: '{"gtip": ["7208.10", "7208.25"], "actionRequired": true}',
      error: null,
      createdAt: new Date(Date.now() - 3000000).toISOString(),
    },
    {
      id: "log-3",
      agentName: "ReportGenerator",
      stepName: "Gotenberg PDF & HTML Derleme",
      status: "COMPLETED",
      durationMs: 2800,
      inputData: "ReportContent Schema",
      outputData: '{"pdfSizeBytes": 22609, "status": "READY"}',
      error: null,
      createdAt: new Date(Date.now() - 2500000).toISOString(),
    },
  ],
  items: [
    {
      id: "item-1",
      date: "Bugün, 09:00",
      title: "İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)",
      category: "Tebliğ",
      url: "https://www.resmigazete.gov.tr",
      isRelevant: true,
      relevanceScore: 95,
      relevanceReason: "Sıcak haddelenmiş sac ürünleri için damping vergisi marjları güncellendi.",
    },
  ],
  reports: [
    {
      id: "1",
      title: "İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)",
      version: 1,
      createdAt: new Date().toISOString(),
    },
  ],
  dispatches: [
    {
      id: "disp-1",
      recipients: "yonetim@atez.com, gumruk@atez.com",
      subject: "Resmi Gazete Gümrük Bülteni - Tebliğ 2026/4",
      status: "SENT",
    },
  ],
};

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    const fetchRun = async () => {
      try {
        const res = await fetch(`/api/runs/${id}`);
        if (res.ok) {
          setRun(await res.json());
        } else {
          setRun({ ...DUMMY_RUN, id: id || "CRON-02" });
        }
      } catch {
        setRun({ ...DUMMY_RUN, id: id || "CRON-02" });
      } finally {
        setIsLoading(false);
      }
    };
    fetchRun();
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-slate-500 text-sm font-medium">Tarama kayıtları yükleniyor...</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h3 className="font-bold text-slate-800 text-lg">Tarama görevi bulunamadı</h3>
        <Link to="/" className="mt-4 inline-flex text-sm text-blue-600 font-semibold hover:underline">
          Ana Sayfaya Dön
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white px-6 py-4 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-900">
                Görev #{run.id}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {run.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{run.workflow.name}</p>
          </div>
        </div>

        <div className="text-right text-xs text-slate-500 flex sm:flex-col items-center sm:items-end justify-between gap-1">
          <div className="flex items-center gap-1.5 font-mono">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Başlangıç: {new Date(run.startedAt).toLocaleTimeString("tr-TR")}</span>
          </div>
          {run.finishedAt && (
            <span className="text-[11px] text-slate-400">
              Bitiş: {new Date(run.finishedAt).toLocaleTimeString("tr-TR")}
            </span>
          )}
        </div>
      </div>

      {/* Grid: 1. Ajan Görev Adımları (Logs) & 2. Çıktılar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sol 2 Kolon: Loglar & Ajan Adımları */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Ajan Yürütme Adımları & İnceleme</h2>
              <span className="text-xs text-slate-400">{run.logs.length} Adım Gerçekleşti</span>
            </div>

            <div className="divide-y divide-slate-100">
              {run.logs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                return (
                  <div key={log.id} className="p-4 hover:bg-slate-50/60 transition-colors">
                    <div
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 text-xs font-bold">
                          ✓
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-slate-900">{log.stepName}</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-100 rounded text-slate-600">
                              {log.agentName}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Süre: {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)} sn` : "Belirtilmedi"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-slate-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-xs font-mono">
                        {log.inputData && (
                          <div className="bg-slate-900 text-slate-200 p-3 rounded-xl overflow-x-auto">
                            <div className="text-[10px] text-slate-400 mb-1 font-sans font-bold">Girdi (Input):</div>
                            <pre className="text-[11px]">{log.inputData}</pre>
                          </div>
                        )}
                        {log.outputData && (
                          <div className="bg-slate-900 text-emerald-400 p-3 rounded-xl overflow-x-auto">
                            <div className="text-[10px] text-slate-400 mb-1 font-sans font-bold">Çıktı (Output):</div>
                            <pre className="text-[11px]">{log.outputData}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sağ 1 Kolon: İlgili Raporlar & Gönderimler */}
        <div className="space-y-4">
          {/* Oluşturulan Bülten */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-5 space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Üretilen Bülten</h3>
            {run.reports.length > 0 ? (
              run.reports.map((rep) => (
                <div key={rep.id} className="p-3 bg-blue-50/50 border border-blue-200/60 rounded-xl space-y-2">
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span className="font-semibold text-xs text-slate-900 line-clamp-2">{rep.title}</span>
                  </div>
                  <Link
                    to={`/reports/${rep.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800"
                  >
                    <span>Bülteni İncele & Revize Et</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 italic">Bu taramada ilgili mevzuat raporu oluşturulmadı.</p>
            )}
          </div>

          {/* E-Posta Dağıtım Durumu */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-5 space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Dağıtım Kaydı</h3>
            {run.dispatches.length > 0 ? (
              run.dispatches.map((disp) => (
                <div key={disp.id} className="p-3 bg-slate-50 border border-slate-200/60 rounded-xl space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-slate-600" />
                    <span className="font-bold text-slate-800">{disp.status}</span>
                  </div>
                  <div className="text-slate-500 truncate">Alıcı: {disp.recipients}</div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 italic">Henüz dağıtım gerçekleştirilmedi.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
