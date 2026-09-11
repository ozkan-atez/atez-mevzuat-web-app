import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  History,
  X,
  Trash2,
  FileText,
  MessageSquare,
  Clock,
  ChevronRight,
  Plus,
  RefreshCw,
} from 'lucide-react';

interface ChatSessionItem {
  id: string;
  title: string;
  type: string;
  reportId?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    messages: number;
  };
  report?: {
    id: string;
    title: string;
    version: number;
  } | null;
}

const DUMMY_SESSIONS: ChatSessionItem[] = [
  {
    id: 'chat-1',
    title: 'PET Resin İthalatında Korunma Önlemi Revizyonu',
    type: 'REPORT_REVISION',
    reportId: '1',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date().toISOString(),
    _count: { messages: 6 },
    report: {
      id: '1',
      title: 'PET Resin İthalatında Korunma Önlemi Uygulanmasına İlişkin Karar (Karar Sayısı: 11509)',
      version: 1,
    },
  },
  {
    id: 'chat-2',
    title: '2026/4 Damping Tebliği GTİP ve Sektör Soruları',
    type: 'GENERAL_QUERY',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86000000).toISOString(),
    _count: { messages: 4 },
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatHistoryDrawer({ isOpen, onClose }: Props) {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchSessions = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/chat/sessions');
        if (res.ok) {
          setSessions(await res.json());
        } else {
          setSessions(DUMMY_SESSIONS);
        }
      } catch {
        setSessions(DUMMY_SESSIONS);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessions();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
          
          {/* Header */}
          <div className="p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
                <History className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Sohbet Geçmişi</h2>
                <p className="text-[11px] text-slate-300">Önceki AI oturumları ve revizyonlar</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* New Chat Button */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <Link
              to="/chat"
              onClick={onClose}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Sohbet Başlat</span>
            </Link>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center p-12 gap-2 text-slate-400">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                <span className="text-xs">Oturumlar yükleniyor...</span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center p-10 text-xs text-slate-400">
                Henüz kayıtlı sohbet geçmişi bulunmuyor.
              </div>
            ) : (
              sessions.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 bg-white rounded-xl border border-slate-200/80 hover:border-blue-300 hover:shadow-xs transition-all space-y-2 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <h4 className="text-xs font-bold text-slate-900 truncate">{item.title}</h4>
                    </div>

                    <button
                      onClick={() => setSessions(prev => prev.filter(s => s.id !== item.id))}
                      className="text-slate-300 hover:text-red-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Oturumu Sil"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {item.report && (
                    <div className="flex items-center gap-1.5 p-2 bg-blue-50/60 border border-blue-100 rounded-lg text-[11px] text-blue-900">
                      <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="truncate">{item.report.title}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(item.createdAt).toLocaleDateString('tr-TR')}</span>
                    </div>

                    <Link
                      to={item.reportId ? `/reports/${item.reportId}` : '/chat'}
                      onClick={onClose}
                      className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-800"
                    >
                      <span>Aç</span>
                      <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
