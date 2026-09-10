import { X, Play } from 'lucide-react'

export function TriggerWorkflowModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="font-bold text-lg">Yeni Tarama Başlat</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kaynak Seçin</label>
            <select className="w-full border-slate-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
              <option>Tüm Kaynaklar (Resmi Gazete, Mevzuat.gov)</option>
              <option>Sadece Resmi Gazete</option>
            </select>
          </div>
          <p className="text-sm text-slate-500">
            Arka planda (pg-boss Worker) yapay zeka analizi çalıştırılacaktır.
          </p>
        </div>
        <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-md transition-colors">İptal</button>
          <button 
            onClick={() => {
              alert("İstek pg-boss kuyruğuna gönderildi!")
              onClose()
            }} 
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-2 transition-colors"
          >
            <Play size={16} /> Başlat
          </button>
        </div>
      </div>
    </div>
  )
}
