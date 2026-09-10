export function PendingApprovalQueue() {
  const dummyReports = [
    { id: 1, title: "Kurumlar Vergisi Genel Tebliği", date: "2026-09-10", source: "Resmi Gazete" },
    { id: 2, title: "Gümrük Yönetmeliğinde Değişiklik", date: "2026-09-09", source: "Resmi Gazete" },
  ]

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h2 className="font-semibold text-slate-800">Onay Bekleyen Raporlar</h2>
        <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full font-medium">2 Adet</span>
      </div>
      <div className="p-0 flex-1">
        <ul className="divide-y divide-slate-100">
          {dummyReports.map(report => (
            <li key={report.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center">
              <div>
                <h3 className="font-medium text-slate-800">{report.title}</h3>
                <p className="text-sm text-slate-500 mt-1">{report.source} • {report.date}</p>
              </div>
              <button className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 border border-blue-200 hover:bg-blue-50 rounded transition-colors">
                İncele & Gönder
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
