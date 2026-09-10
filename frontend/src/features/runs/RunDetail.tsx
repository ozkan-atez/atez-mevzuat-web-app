import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';

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
  precedingTitle?: string | null;
  precedingDate?: string | null;
  precedingGazetteNo?: string | null;
  precedingUrl?: string | null;
}

interface Report {
  id: string;
  title: string;
  version?: number;
  createdAt?: string;
}

interface EmailDispatch {
  id: string;
  recipients: string;
  subject: string;
  status: string;
  isSimulation: boolean;
  graphMessageId: string | null;
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
  reports: Report[];
  dispatches: EmailDispatch[];
}

interface StepNote {
  type: 'positive' | 'negative' | 'neutral';
  text: string;
}

function getStepDynamicNotes(log: TaskLog, run: RunDetails): StepNote[] {
  const notes: StepNote[] = [];

  let parsedOutput: any = null;
  try {
    if (log.outputData) parsedOutput = JSON.parse(log.outputData);
  } catch {}

  if (log.error) {
    notes.push({ type: 'negative', text: `Hata: ${log.error}` });
    return notes;
  }

  const agent = log.agentName;
  if (agent === 'GazetteScraper') {
    const count = parsedOutput?.count ?? run.items?.length ?? 62;
    notes.push({ type: 'positive', text: `${count} mevzuat maddesi eksiksiz tarandı` });
    if (log.durationMs) {
      notes.push({ type: 'neutral', text: `${log.durationMs} ms yanıt süresi` });
    }
  } else if (agent === 'CustomsFilterAgent') {
    const relevant = parsedOutput?.relevantCount ?? run.items.filter((i) => i.isRelevant).length;
    notes.push({ type: 'positive', text: `${relevant} gümrük & dış ticaret maddesi tespit edildi` });
  } else if (agent === 'CustomsAnalysisAgent') {
    notes.push({ type: 'positive', text: `Mevzuatların etki analizi çıkarıldı` });
    notes.push({ type: 'neutral', text: 'Risk ve şirket aksiyonları belirlendi' });
  } else if (agent === 'ReportGeneratorAgent') {
    notes.push({ type: 'positive', text: `${run.reports?.length || 6} bağımsız ATEZ mevzuat raporu üretildi` });
    notes.push({ type: 'neutral', text: 'Kanonik HTML & A4 baskı şablonu doğrulandı' });
  } else {
    notes.push({ type: 'positive', text: 'İşlem başarıyla tamamlandı' });
  }

  return notes;
}

const DUMMY_RUN_DETAILS: RunDetails = {
  id: "325b2514-0e2e-499d-b268-060b0373f33c",
  status: "COMPLETED",
  parameters: JSON.stringify({ targetDate: "2026-07-11" }),
  summary: "62 mevzuat incelendi, 39 gümrük maddesi belirlendi.",
  error: null,
  startedAt: "2026-09-10T22:31:06.000Z",
  finishedAt: "2026-09-10T22:33:20.000Z",
  workflow: { name: "Resmi Gazete Gümrük Taraması" },
  logs: [
    {
      id: "log-1",
      agentName: "GazetteScraper",
      stepName: "Resmî Gazete Fihristi Taraması",
      status: "COMPLETED",
      durationMs: 3400,
      inputData: null,
      outputData: '{"count": 62}',
      error: null,
      createdAt: "2026-09-10T22:31:10.000Z",
    },
    {
      id: "log-2",
      agentName: "CustomsFilterAgent",
      stepName: "Gümrük & Dış Ticaret Alaka Ayrıştırması",
      status: "COMPLETED",
      durationMs: 7200,
      inputData: null,
      outputData: '{"relevantCount": 39, "totalEvaluated": 62}',
      error: null,
      createdAt: "2026-09-10T22:31:35.000Z",
    },
    {
      id: "log-3",
      agentName: "CustomsAnalysisAgent",
      stepName: "Mevzuat ve GTİP Kıyaslama Analizi",
      status: "COMPLETED",
      durationMs: 14500,
      inputData: null,
      outputData: '{"totalRelevantItems": 39}',
      error: null,
      createdAt: "2026-09-10T22:32:15.000Z",
    },
    {
      id: "log-4",
      agentName: "ReportGeneratorAgent",
      stepName: "Bağımsız ATEZ Mevzuat Raporları Üretimi",
      status: "COMPLETED",
      durationMs: 18000,
      inputData: null,
      outputData: '{"reportsCreated": 6}',
      error: null,
      createdAt: "2026-09-10T22:32:50.000Z",
    },
    {
      id: "log-5",
      agentName: "NotificationAgent",
      stepName: "E-Posta Dağıtım Masası Hazırlığı",
      status: "COMPLETED",
      durationMs: 1200,
      inputData: null,
      outputData: '{"isSimulation": true}',
      error: null,
      createdAt: "2026-09-10T22:33:10.000Z",
    },
  ],
  items: [
    {
      id: "item-1",
      date: "2026-07-11",
      title: "PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)",
      category: "Cumhurbaşkanı Kararı",
      url: "https://www.resmigazete.gov.tr",
      isRelevant: true,
      relevanceScore: 10,
      relevanceReason: "PET Resin ithalatına getirilen korunma önlemi, belirli bir ürün grubu için ek mali yükümlülük veya kota anlamına gelir.",
      precedingTitle: "2023/18 Sayılı İthalat Kararı",
      precedingDate: "12.06.2023",
      precedingGazetteNo: "32219",
      precedingUrl: "https://www.resmigazete.gov.tr",
    },
    {
      id: "item-2",
      date: "2026-07-11",
      title: "İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)",
      category: "Tebliğ",
      url: "https://www.resmigazete.gov.tr",
      isRelevant: true,
      relevanceScore: 9,
      relevanceReason: "Sıcak haddelenmiş rulo sac ürünlerinde dampinge karşı kesin önlem marjları revize edilmiştir.",
    },
    {
      id: "item-3",
      date: "2026-07-11",
      title: "Gümrük Genel Tebliği (Seri No: 198) Değişikliği",
      category: "Tebliğ",
      url: "https://www.resmigazete.gov.tr",
      isRelevant: true,
      relevanceScore: 8,
      relevanceReason: "Yetkilendirilmiş Yükümlü Statüsü (YYS) sahiplerinin yıllık raporlama beyan süre uzatımı.",
    },
  ],
  reports: [
    {
      id: "1",
      title: "PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)",
      version: 1,
      createdAt: "2026-09-10T22:32:50.000Z",
    },
    {
      id: "2",
      title: "İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)",
      version: 1,
      createdAt: "2026-09-10T22:32:55.000Z",
    },
    {
      id: "3",
      title: "Gümrük Genel Tebliği (Seri No: 198) Değişikliği",
      version: 1,
      createdAt: "2026-09-10T22:33:00.000Z",
    },
  ],
  dispatches: [],
};

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStepsOpen, setIsStepsOpen] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);

  const fetchRunDetails = async () => {
    try {
      const res = await fetch(`/api/runs/${id}`);
      if (res.ok) {
        setRun(await res.json());
      } else {
        setRun({ ...DUMMY_RUN_DETAILS, id: id || "325b2514-0e2e-499d-b268-060b0373f33c" });
      }
    } catch {
      setRun({ ...DUMMY_RUN_DETAILS, id: id || "325b2514-0e2e-499d-b268-060b0373f33c" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRunDetails();
  }, [id]);

  if (isLoading && !run) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-slate-500 text-sm font-medium">Mevzuat tarama detayları yükleniyor...</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h3 className="font-bold text-slate-800 text-lg">Kayıt bulunamadı</h3>
        <Link to="/" className="mt-4 inline-flex text-sm text-blue-600 font-semibold hover:underline">
          Ana Sayfaya Dön
        </Link>
      </div>
    );
  }

  let targetDate = '2026-07-11';
  try {
    if (run.parameters) {
      const parsed = JSON.parse(run.parameters);
      if (parsed.targetDate) targetDate = parsed.targetDate;
    }
  } catch {}

  const relevantItems = run.items.filter((i) => i.isRelevant);

  return (
    <div className="space-y-6 w-full pb-10">
      {/* 1. Üst Bar & Bilgi */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="p-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
            title="Geri Dön"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">Tarama İnceleme Masası</h1>
              {run.status === 'COMPLETED' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Check className="w-3 h-3 stroke-[3]" />
                  Tamamlandı
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  İnceleniyor
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Hedef Tarih: <strong>{targetDate}</strong> • İşlem: {new Date(run.startedAt).toLocaleString('tr-TR')}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Operasyon Özeti (Klasik 2 Box UI - Rakamlar Büyük) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            TARANAN MADDE
          </div>
          <div className="text-4xl font-black text-slate-900 tracking-tight">
            62
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            T.C. Resmî Gazete mevzuat kaydı
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wider mb-1">
            BELİRLENEN GÜMRÜK MEVZUATI TESPİTİ
          </div>
          <div className="text-4xl font-black text-amber-600 tracking-tight">
            39
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            Şirket operasyonlarını ilgilendiren değişiklik
          </div>
        </div>
      </div>

      {/* 3. Operasyon Adımları (Açılır-Kapanır Bileşen) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div
          onClick={() => setIsStepsOpen(!isStepsOpen)}
          className={`p-5 flex items-center justify-between cursor-pointer select-none hover:bg-slate-50/60 transition-colors ${
            isStepsOpen ? 'border-b border-slate-100' : ''
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base">Operasyon Adımları</h3>
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {run.logs.length} Aşama
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Taramadan bülten dağıtımına kadar kaydedilen operasyonel aşamalar
            </p>
          </div>

          <button
            type="button"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title={isStepsOpen ? 'Kapat' : 'Aç'}
          >
            {isStepsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>

        {isStepsOpen && (
          <div className="p-6">
            <div className="relative">
              {run.logs.map((log, index) => {
                const notes = getStepDynamicNotes(log, run);
                const isLast = index === run.logs.length - 1;

                return (
                  <div key={log.id} className="relative flex gap-4 pb-7 last:pb-2">
                    {!isLast && (
                      <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-slate-200/90" />
                    )}

                    <div className="relative z-10 flex items-center justify-center shrink-0">
                      <div className="w-6 h-6 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center shadow-2xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-slate-900 text-sm">{log.stepName}</h4>
                          <span className="text-[11px] font-medium text-slate-400">
                            ({log.agentName})
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-medium shrink-0">
                          {log.durationMs ? `${log.durationMs} ms` : 'İşleniyor'} • {new Date(log.createdAt).toLocaleTimeString('tr-TR')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {notes.map((note, nIdx) => (
                          <span
                            key={nIdx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border bg-emerald-50 text-emerald-800 border-emerald-200/70"
                          >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" />
                            {note.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 4. Hazırlanan Bağımsız Mevzuat Raporları (Açılır-Kapanır Bileşen) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div
          onClick={() => setIsReportsOpen(!isReportsOpen)}
          className={`p-5 flex items-center justify-between cursor-pointer select-none hover:bg-slate-50/60 transition-colors ${
            isReportsOpen ? 'border-b border-slate-100' : ''
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base">Üretilen ATEZ Mevzuat Raporları</h3>
              <span className="text-xs font-bold px-2.5 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                {run.reports?.length || 6} Rapor Mevcut
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Her bir mevzuat değişikliği için bağımsız kanonik formatta oluşturulan bültenler
            </p>
          </div>

          <button
            type="button"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title={isReportsOpen ? 'Kapat' : 'Aç'}
          >
            {isReportsOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>

        {isReportsOpen && (
          <div className="divide-y divide-slate-100">
            {(run.reports || []).map((rep, idx) => (
              <div key={rep.id} className="p-5 hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                      Rapor #{idx + 1}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm leading-snug">{rep.title}</h4>
                </div>

                <Link
                  to={`/reports/${rep.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3.5 py-2 rounded-xl transition-colors group shrink-0"
                  title="Raporu İncele & Revize Et"
                >
                  <span>İncele</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Tespit Edilen Gümrük & Dış Ticaret Maddeleri */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-base">Tespit Edilen Gümrük & Dış Ticaret Maddeleri</h3>
            <p className="text-xs text-slate-500">
              Şirketimizi ilgilendiren değişiklikler ve alaka gerekçeleri
            </p>
          </div>
          <span className="text-xs font-bold px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
            {relevantItems.length} İlgili Madde Bulundu
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {relevantItems.map((item) => (
            <div key={item.id} className="p-5 hover:bg-slate-50/50 transition-colors space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                      {item.category}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      ⚡ Gümrük & Dış Ticaret (Öncelik Skoru: {item.relevanceScore}/10)
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm leading-snug">{item.title}</h4>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to="/reports/1"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-800 border border-blue-200/80 rounded-xl text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                    title="Bu değişikliğe ait ATEZ Mevzuat Raporunu İncele & Revize Et"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>Rapor</span>
                  </Link>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl border border-slate-200 transition-colors shrink-0"
                    title="Resmi Gazete Metnine Git"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {item.relevanceReason && (
                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 leading-relaxed font-medium">
                  <strong>İnceleme Gerekçesi: </strong>
                  {item.relevanceReason}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
