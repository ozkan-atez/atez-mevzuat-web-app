import { useState, useEffect } from 'react';
import {
  X,
  Mail,
  Send,
  Paperclip,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  reportId?: string;
  runId?: string;
  onDispatched?: () => void;
}

export function EmailDispatchModal({
  isOpen,
  onClose,
  reportId,
  runId,
  onDispatched,
}: Props) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const [customerGroups, setCustomerGroups] = useState<any[]>([]);
  // Form alanları
  const [fromEmail, setFromEmail] = useState('atezmevzuat@gmail.com');
  const [fromName, setFromName] = useState('ATEZ Gümrük & Mevzuat Radarı');
  const [toInput, setToInput] = useState('');
  const [subject, setSubject] = useState('');
  const [messageText, setMessageText] = useState('');
  const [pdfFileName, setPdfFileName] = useState('Mevzuat_Bulteni.pdf');
  const [reportTitle, setReportTitle] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [gmailAppPassword] = useState('');

  // Sonuç durumu
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    isSimulation: boolean;
    messageId?: string;
    note?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSendResult(null);
      return;
    }

    const fetchGroups = async () => {
      try {
        const res = await fetch('/api/customer-groups');
        if (res.ok) setCustomerGroups(await res.json());
      } catch (err) {}
    };

    const fetchPreview = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/mail/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId, runId }),
        });

        if (res.ok) {
          const data = await res.json();
          setFromEmail(data.from || 'atezmevzuat@gmail.com');
          setFromName(data.fromName || 'ATEZ Gümrük & Mevzuat Radarı');
          setReportTitle(data.reportTitle || '');
          setSubject(data.subject || '');
          setMessageText(data.plainTextMessage || '');
          setPdfFileName(data.pdfFileName || 'ATEZ_Mevzuat_Bulteni.pdf');

          if (data.defaultTo && Array.isArray(data.defaultTo) && toInput === '') {
            setToInput(data.defaultTo.join(', '));
          }
        }
      } catch (err) {
        console.error('E-posta taslağı yüklenirken hata:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroups();
    fetchPreview();
  }, [isOpen, reportId, runId]);

  if (!isOpen) return null;

  const handleSend = async () => {
    const cleanRecipients = toInput
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (cleanRecipients.length === 0) {
      alert('Lütfen en az bir geçerli alıcı e-posta adresi giriniz.');
      return;
    }

    if (!subject.trim()) {
      alert('Lütfen bir konu giriniz.');
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const res = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          runId,
          from: fromEmail,
          fromName,
          to: cleanRecipients,
          subject: subject.trim(),
          messageText: messageText.trim(),
          attachPdf,
          gmailAppPassword: gmailAppPassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gönderim başarısız oldu.');
      }

      setSendResult({
        success: data.success,
        isSimulation: data.isSimulation,
        messageId: data.messageId,
        note: data.note,
        error: data.error,
      });

      if (onDispatched) onDispatched();
    } catch (err: any) {
      setSendResult({
        success: false,
        isSimulation: false,
        error: err.message || 'E-posta gönderilirken bir hata oluştu.',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Başlık */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Mail className="w-4 h-4 text-blue-400" />
            <div>
              <h3 className="text-sm font-bold text-white">E-Posta ile Bülten Gönder</h3>
              {reportTitle && (
                <p className="text-[11px] text-slate-300 max-w-xs sm:max-w-md truncate">
                  {reportTitle}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* İçerik */}
        {sendResult ? (
          <div className="p-6 text-center space-y-4">
            {sendResult.success ? (
              <>
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7 stroke-[2.5]" />
                </div>
                <h4 className="text-base font-bold text-slate-900">
                  {sendResult.isSimulation ? 'E-Posta Simüle Edildi & Kaydedildi' : 'E-Posta Başarıyla Gönderildi!'}
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
                  {sendResult.note || 'Bülten ve ekteki PDF dosyası başarıyla iletildi.'}
                </p>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-left space-y-1 font-mono text-slate-700">
                  <div><strong>Alıcılar:</strong> {toInput}</div>
                  <div><strong>PDF Eki:</strong> {pdfFileName}</div>
                </div>
                <button
                  onClick={onClose}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Tamamla
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-7 h-7 stroke-[2.5]" />
                </div>
                <h4 className="text-base font-bold text-slate-900">Gönderilemedi</h4>
                <p className="text-xs text-red-600">{sendResult.error}</p>
                <button
                  onClick={() => setSendResult(null)}
                  className="px-4 py-1.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Tekrar Dene
                </button>
              </>
            )}
          </div>
        ) : isLoading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
            <span className="text-xs font-medium">Bülten taslağı hazırlanıyor...</span>
          </div>
        ) : (
          <div className="p-5 space-y-3.5 text-xs">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700">Alıcılar (Kime):</label>
              </div>
              <input
                type="text"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                placeholder="ornek@atez.com, diger@gmail.com"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-mono text-[11px]"
              />
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {customerGroups.length === 0 && (
                  <span className="text-[10px] text-slate-400 italic">Henüz grup eklenmemiş. 'Müşteri Grupları'ndan ekleyebilirsiniz.</span>
                )}
                {customerGroups.map(group => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => {
                      const currentEmails = toInput.split(',').map(e => e.trim()).filter(e => e);
                      const groupEmails = group.emails.split(',').map((e: string) => e.trim()).filter((e: string) => e);
                      const merged = Array.from(new Set([...currentEmails, ...groupEmails]));
                      setToInput(merged.join(', '));
                    }}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors cursor-pointer"
                    title={group.description || group.name}
                  >
                    + {group.name}
                  </button>
                ))}
                {toInput && (
                  <button
                    type="button"
                    onClick={() => setToInput('')}
                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-colors cursor-pointer ml-auto"
                  >
                    Temizle
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-700">Konu:</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 font-medium"
              />
            </div>

            <div className="flex items-center justify-between p-2.5 bg-blue-50/60 border border-blue-200/80 rounded-xl">
              <div className="flex items-center gap-2 text-blue-950 font-medium truncate">
                <Paperclip className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate">{pdfFileName}</span>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-blue-700 font-semibold cursor-pointer shrink-0 ml-2">
                <input
                  type="checkbox"
                  checked={attachPdf}
                  onChange={(e) => setAttachPdf(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span>PDF Ekle</span>
              </label>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-700">Bülten Mesajı (Düzenlenebilir):</label>
              <textarea
                rows={6}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 leading-relaxed font-sans text-xs resize-none"
              />
            </div>

            <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Gönderen: <strong className="text-slate-700">{fromEmail}</strong>
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Kalıcı E-Posta Bağlantısı Aktif
              </span>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Vazgeç
              </button>

              <button
                type="button"
                onClick={handleSend}
                disabled={isSending}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 hover:from-slate-900 hover:to-blue-900 text-white rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isSending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Gönderiliyor...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>E-Postayı Gönder</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
