import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, X, Play } from 'lucide-react';
import { createManualScan } from '../scans/api';
import { sourceOptions, type SourceOption } from '../sources/sourceRunsApi';

interface Props {
  onClose: () => void;
  onTriggered?: (runId: string) => void;
}

const sourceChoices = [
  { key: 'resmi-gazete', name: 'Resmî Gazete' },
  { key: 'ticaret-bakanligi', name: 'Ticaret Bakanlığı' },
  { key: 'igmd', name: 'İGMD' },
  { key: 'mevzuat-net', name: 'Mevzuat.Net' },
  { key: 'tariff', name: 'TARIFF' },
];

export function TriggerWorkflowModal({ onClose, onTriggered }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>(['resmi-gazete']);
  useEffect(() => { void sourceOptions().then(setSources).catch(() => setError('Kaynak seçenekleri yüklenemedi.')); }, []);

  const handleTrigger = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (selectedSources.length === 0) throw new Error('En az bir kaynak seçin.');
      const unavailable = selectedSources.find((key) => key !== 'resmi-gazete' && !sources.find((source) => source.key === key)?.available);
      if (unavailable) throw new Error(sources.find((source) => source.key === unavailable)?.reason ?? 'Seçilen kaynak kullanılamıyor.');
      const data = await createManualScan(selectedDate, selectedSources);
      onTriggered?.(data.runId);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tarama başlatılamadı');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          disabled={isLoading}
          aria-label="Kapat"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Kaynak taraması başlat</h3>
            <p className="text-xs text-slate-500">Hedef tarih için otomatik mevzuat taramasını başlatın</p>
          </div>
        </div>

        <div className="space-y-4 my-6">
          <div><p className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Kaynaklar</p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Taranacak kaynaklar">
              {sourceChoices.map((choice) => {
                const source = sources.find((item) => item.key === choice.key);
                const available = choice.key === 'resmi-gazete' || Boolean(source?.available);
                const checked = selectedSources.includes(choice.key);
                return <button key={choice.key} type="button" role="checkbox" aria-label={choice.name} aria-checked={checked} title={!available ? source?.reason ?? 'Bu kaynak henüz kullanılamıyor.' : choice.name} disabled={isLoading || !available} onClick={() => setSelectedSources((current) => checked ? current.filter((key) => key !== choice.key) : [...current, choice.key])} className={`inline-flex w-auto max-w-full items-center whitespace-nowrap rounded-full border px-4 py-2 text-left text-xs font-semibold transition-all duration-200 ${checked ? 'border-indigo-500 bg-indigo-50 text-indigo-800 shadow-sm ring-1 ring-indigo-500/10' : 'border-slate-200 bg-white text-slate-700 shadow-xs'} ${available ? 'cursor-pointer hover:-translate-y-px hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-800 hover:shadow-sm' : 'cursor-not-allowed bg-slate-50 text-slate-400 opacity-60'}`}>
                  {choice.name}
                </button>;
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Taranacak tarih
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={isLoading}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-slate-800 text-sm font-medium"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Seçilen kaynaklar tek tarama kaydında işlenir; sonuçları aynı tarama sayfasında görürsünüz.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || selectedSources.length === 0}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleTrigger}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-[#17264a] px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-slate-900/15 transition-all hover:-translate-y-px hover:bg-[#203565] hover:shadow-xl hover:shadow-indigo-950/20 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
            <span>Taramayı Başlat</span>
          </button>
        </div>
      </div>
    </div>
  );
}
