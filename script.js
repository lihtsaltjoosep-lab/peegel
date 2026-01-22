let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], sessionStartTime = "", pitchHistory = [], silenceTimeout = null;

// 1. KELL
setInterval(() => { 
    const el = document.getElementById('clock');
    if(el) el.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS
const dbReq = indexedDB.open("Peegel_Final_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("log", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. ANALÜÜS
async function startApp() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyser.connect(processor); processor.connect(ctx.destination);
        
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) chunks.push(e.data); };
        
        processor.onaudioprocess = () => {
            if (!isLive) return;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const volume = data.reduce((a,b) => a+b) / data.length;
            
            let maxVal = -1, maxIdx = -1;
            for (let i = 0; i < data.length/2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
            const pitch = maxIdx * (ctx.sampleRate/2) / (data.length/2);

            document.getElementById('mic-bar').style.width = Math.min(volume * 5, 100) + "%";
            document.getElementById('hz-val').innerText = Math.round(pitch) + " Hz";

            let isSpeech = volume > 3 && pitch > 50 && pitch < 1500;
            
            if (isSpeech) {
                speechMs += 50; pitchHistory.push(pitch);
                document.getElementById('status-light').style.background = "#22c55e"; // Roheline
                
                // Kui tuvastame kõne, tühistame lõpetamise taimeri
                if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
                
                // Käivitame/jätkame salvestamist
                if (mediaRecorder.state === "inactive") {
                    mediaRecorder.start(100); // Väikesed tükid, et puhver oleks värske
                } else if (mediaRecorder.state === "paused") {
                    mediaRecorder.resume();
                }
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155"; // Hall
                
                // LÕIKAMISE VIIVITUS: 1.2 sekundit (1200 ms)
                if (mediaRecorder.state === "recording" && !silenceTimeout) {
                    silenceTimeout = setTimeout(() => {
                        if (mediaRecorder.state === "recording") {
                            mediaRecorder.pause();
                        }
                        silenceTimeout = null;
                    }, 1200); 
                }
            }
            document.getElementById('s-val').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('v-val').innerText = Math.round(silenceMs/1000) + "s";
        };
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga seadmes."); }
}

// 4. SALVESTAMINE
function saveSegment(callback) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        const endTime = new Date().toLocaleTimeString('et-EE');
        const note = document.getElementById('session-note').value.trim();
        mediaRecorder.onstop = () => {
            let finalHz = pitchHistory.length > 0 ? Math.round(pitchHistory.reduce((a,b)=>a+b)/pitchHistory.length) : 0;
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const tx = db.transaction("log", "readwrite");
                tx.objectStore("log").add({ id: Date.now(), start: sessionStartTime, end: endTime, audio: reader.result, avgHz: finalHz, note: note });
                tx.oncomplete = () => { renderHistory(); if(callback) callback(); };
            };
        };
        mediaRecorder.stop();
    } else if (callback) callback();
}

// 5. NUPUD
document.getElementById('startBtn').onclick = () => {
    document.getElementById('start-section').classList.add('hidden');
    document.getElementById('mic-section').classList.remove('hidden');
    startApp();
};

const toggleHistory = () => {
    const container = document.getElementById('history-container');
    const startSection = document.getElementById('start-section');
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        startSection.classList.add('hidden');
    } else {
        container.classList.add('hidden');
        if (!isLive) startSection.classList.remove('hidden');
    }
};

document.getElementById('toggleHistoryBtn').onclick = toggleHistory;
document.getElementById('closeHistoryBtn').onclick = toggleHistory;

document.getElementById('fixBtn').onclick = () => {
    saveSegment(() => {
        chunks = []; speechMs = 0; silenceMs = 0; pitchHistory = [];
        document.getElementById('session-note').value = "";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
    });
};

document.getElementById('stopBtn').onclick = () => {
    if (confirm("Lõpeta?")) { isLive = false; if(wakeLock) wakeLock.release(); saveSegment(() => location.reload()); }
};

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").getAll().onsuccess = e => {
        const items = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-list').innerHTML = items.map(s => `
            <div class="glass rounded-[30px] p-6 border border-white/5">
                <div class="flex justify-between text-[10px] text-slate-500 font-bold mb-4">
                    <span>${s.start} — ${s.end}</span>
                    <button onclick="del(${s.id})">🗑️</button>
                </div>
                <div class="flex gap-2 mb-4">
                    <button onclick="fullDownload(${s.id})" class="flex-1 bg-blue-600/10 text-blue-400 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest">Download</button>
                    ${s.note ? `<button onclick="this.nextElementSibling.classList.toggle('hidden')" class="flex-1 bg-white/5 text-slate-400 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest">Märge</button>
                    <div class="hidden mt-4 p-4 bg-black/40 rounded-xl text-xs text-slate-300 w-full italic">${s.note}</div>` : ''}
                </div>
                <audio controls src="${s.audio}" class="w-full h-8 opacity-60"></audio>
            </div>`).join('');
    };
}

window.del = id => { if(confirm("Kustuta?")) { const tx = db.transaction("log", "readwrite"); tx.objectStore("log").delete(id); tx.oncomplete = renderHistory; } };

window.fullDownload = id => {
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").get(id).onsuccess = e => {
        const d = e.target.result;
        const html = `<html><body style="background:#020617;color:white;padding:40px;font-family:sans-serif;"><h2>Sessioon: ${d.start}</h2><p>${d.note || ''}</p><audio controls src="${d.audio}"></audio></body></html>`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], {type:'text/html'}));
        a.download = `Sessioon_${d.id}.html`; a.click();
    };
};
