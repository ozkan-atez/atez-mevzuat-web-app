import { useState } from 'react';
import { Calendar, AlertCircle, RefreshCw, X, Play } from 'lucide-react';
import { createManualScan } from '../scans/api';

interface Props {
  onClose: () => void;
  onTriggered?: (runId: string) => void;
}

export function TriggerWorkflowModal({ onClose, onTriggered }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrigger = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await createManualScan(selectedDate);
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
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          disabled={isLoading}
          aria-label="Kapat"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Resmi Gazete Gümrük Taraması</h3>
            <p className="text-xs text-slate-500">Hedef tarih için otomatik mevzuat taramasını başlatın</p>
          </div>
        </div>

        <div className="space-y-4 my-6">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Taranacak Resmi Gazete Tarihi
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={isLoading}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-slate-800 text-sm font-medium"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              Seçilen tarihin ana ve mükerrer Resmî Gazete belgeleri ile bağlı dosyaları arşivlenecektir. Analiz bu aşamaya dahil değildir.
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
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleTrigger}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer transition-all active:scale-95 disabled:opacity-50"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
            <span>Taramayı Başlat</span>
          </button>
        </div>
      </div>
    </div>
  );
}
