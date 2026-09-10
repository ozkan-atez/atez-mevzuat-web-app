import { useState } from 'react'
import { Send, Bot } from 'lucide-react'

export function GeminiLandingChat() {
  const [messages, setMessages] = useState<{role: 'user'|'ai', text: string}[]>([
    { role: 'ai', text: 'Merhaba, ben mevzuat asistanınızım. Son değişiklikler hakkında ne öğrenmek istersiniz?' }
  ])
  const [input, setInput] = useState('')

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    
    setMessages(prev => [...prev, { role: 'user', text: input }])
    setInput('')
    
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'ai', text: 'Sistem şu anda test modunda. Gerçek SSE akışı test sayfasında aktif edilebilir.' }])
    }, 1000)
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col h-full min-h-[400px]">
      <div className="p-4 border-b border-slate-100 bg-blue-50/50 flex items-center gap-2">
        <Bot className="text-blue-600" size={20} />
        <h2 className="font-semibold text-slate-800">Mevzuat Asistanı</h2>
      </div>
      
      <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[300px]">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg p-3 text-sm shadow-sm ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800 border border-slate-200'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-slate-100 bg-slate-50">
        <form onSubmit={handleSend} className="relative">
          <input 
            type="text" 
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Mevzuat sorunuz..." 
            className="w-full pl-4 pr-10 py-2 bg-white border border-slate-300 rounded-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm shadow-inner"
          />
          <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors">
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
