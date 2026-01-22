// ... (startSession, fixSession ja bufferToWav jäävad samaks) ...

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5 text-left">
                <div class="flex justify-between items-center text-[11px] uppercase tracking-tight">
                    <span class="flex gap-2 items-center">
                        <span class="text-log-time">${s.start}-${s.end}</span>
                        <span class="text-divider">|</span>
                        <span class="text-hz-low">${s.hzMin}</span>
                        <span class="text-divider">-</span>
                        <span class="text-hz-high">${s.hzMax}</span>
                        <span class="text-hz-label">HZ</span>
                        <span class="text-divider">|</span>
                        <span class="text-log-silence">V:${s.v}s</span>
                    </span>
                    <button onclick="delS(${s.id})" class="btn-delete-dark">KUSTUTA</button>
                </div>
                
                <div class="p-4 bg-blue-500/5 rounded-2xl space-y-3 border border-blue-500/10">
                    <div class="flex justify-between items-center text-[9px] font-black text-blue-400 uppercase tracking-widest">
                        <span>Puhas vestlus (${s.s}s)</span>
                        <button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')" class="text-blue-400 border border-blue-400/20 px-2 py-0.5 rounded">Download</button>
                    </div>
                    <audio src="${s.audioClean}" controls preload="metadata"></audio>
                </div>

                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-3 text-[10px] font-black uppercase text-log-time bg-green-500/10 rounded-2xl">Kuva Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs italic text-slate-300 border-l-2 border-green-500">${s.note || '...'}</div>
            </div>`).join('');
    };
}

// ... (Muud funktsioonid jäävad samaks) ...
