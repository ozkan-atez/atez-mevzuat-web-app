import { useState } from 'react';

export function DockedAiAssistant() {
  const [input, setInput] = useState('');

  return (
    <aside className="fixed bottom-0 inset-x-0 z-40 p-3 sm:p-4 pointer-events-none" data-purpose="docked-copilot-bar">
      <div className="max-w-4xl mx-auto w-[92%] sm:w-full pointer-events-auto pb-2 sm:pb-3">
        <div className="flex items-center gap-2.5 overflow-x-auto pb-2 custom-scroll">
          <button onClick={() => setInput("Cron job detay modalı veya log geçmişi")} className="relative group inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-medium text-slate-200 bg-[#16171b]/95 border border-slate-700/60 hover:border-purple-500/50 transition-all shadow-md backdrop-blur-md" type="button">
            <span className="truncate max-w-[220px] sm:max-w-[280px]">Cron job detay modalı veya log geçmişi</span>
          </button>
          <button onClick={() => setInput("Yapay zeka asistanı açıkken chat geçmişini göster")} className="relative group inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-medium text-slate-200 bg-[#16171b]/95 border border-slate-700/60 hover:border-purple-500/50 transition-all shadow-md backdrop-blur-md" type="button">
            <span className="truncate max-w-[220px] sm:max-w-[280px]">Yapay zeka asistanı açıkken chat geçmişini göster</span>
          </button>
        </div>
        
        <div className="relative rounded-[26px] p-[1.5px] bg-gradient-to-r from-purple-500/30 via-indigo-500/20 to-teal-500/30 shadow-2xl backdrop-blur-xl">
          <div className="bg-[#14151a]/95 rounded-[25px] p-4 sm:p-5 flex flex-col gap-4 border border-white/5">
            <div className="w-full">
              <input 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full bg-transparent border-0 text-slate-100 text-sm sm:text-base placeholder-slate-400 font-normal p-0 focus:ring-0 outline-none leading-relaxed" 
                placeholder="Ne değiştirmek veya oluşturmak istiyorsunuz?" 
                type="text" 
              />
            </div>
            
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-3 text-slate-400">
                <button className="p-1 text-slate-300 hover:text-white transition active:scale-95" title="Ekle" type="button">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                </button>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <button className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95" title="Gönder" type="submit">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 19.5V4.5m0 0l-6 6m6-6l6 6" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
