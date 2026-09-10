import { useState } from 'react'
import { Activity, FileText, CheckCircle, Clock } from 'lucide-react'
import { PendingApprovalQueue } from './PendingApprovalQueue'
import { TriggerWorkflowModal } from './TriggerWorkflowModal'
import { GeminiLandingChat } from '../chat/GeminiLandingChat'

export function Dashboard() {
  const [isModalOpen, setModalOpen] = useState(false)
  
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Genel Bakış</h1>
          <p className="text-sm text-slate-500 mt-1">Mevzuat analiz ve raporlama merkezi</p>
        </div>
        <button 
          onClick={() => setModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors shadow-sm"
        >
          Yeni Tarama Başlat
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Toplam Tarama" value="124" icon={Activity} />
        <StatCard title="Onay Bekleyen" value="3" icon={Clock} color="text-amber-500" />
        <StatCard title="Gönderilen Rapor" value="89" icon={CheckCircle} color="text-green-500" />
        <StatCard title="Toplam Mevzuat" value="1,204" icon={FileText} color="text-blue-500" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <PendingApprovalQueue />
        </div>
        <div className="xl:col-span-1">
          <GeminiLandingChat />
        </div>
      </div>

      {isModalOpen && <TriggerWorkflowModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}

function StatCard({ title, value, icon: Icon, color = 'text-slate-500' }: any) {
  return (
    <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`p-3 rounded-full bg-slate-50 ${color}`}>
        <Icon size={24} />
      </div>
      <div>
        <div className="text-sm text-slate-500 font-medium">{title}</div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
      </div>
    </div>
  )
}
