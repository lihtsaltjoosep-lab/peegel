let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], sessionStartTime = "", pitchHistory = [], silenceTimeout = null;
let preBuffer = []; // Hoiab viimast 1.2s vaikust, et see kõne algusse kleepida

// 1. KELL
setInterval(() => { 
    const el = document.getElementById('clock');
    if(el) el.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS
const dbReq = indexedDB.open("Peegel_Final_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("log", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. ANALÜÜS JA NUTIKAS FILTREERIMINE
async function startApp() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } 
        });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyser.connect(processor); processor.connect(ctx.destination);
        
        mediaRecorder = new MediaRecorder(stream);
        
        // SELLE LOOGIKAGA FILTREERIME VAIKUSE VÄLJA:
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0 && isLive) {
                const isSpeechActive = document.getElementById('status-light').style.background === "rgb(34, 197, 94)";
                
                if (isSpeechActive || silenceTimeout) {
                    // Kui on kõne või 1.2s lõpuaken, siis salvestame
                    chunks.push(e.data);
                } else {
                    // Kui on vaikus, hoiame ainult viimast 1.2s puhvris (ca 12 tükki)
                    preBuffer.push(e.data);
                    if (preBuffer.length > 12) preBuffer.shift();
                }
            }
        };

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

            let isSpeech = volume > 2.5 && pitch > 50; // Tundlik hääle tuvastus
            
            if (isSpeech) {
                speechMs += 50;
                pitchHistory.push(pitch);
                document.getElementById('status-light').style.background = "#22c55e"; // Roheline
                
                // Kui kõne algab, kleebime algusse puhvris olnud 1.2s vaikust
                if (preBuffer.length > 0) {
                    chunks.push(...preBuffer);
                    preBuffer = [];
                }
                
                if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
            } else {
                silenceMs += 50;
                // Kui tekib vaikus, ootame 1.2s enne kui salvestamise lõpetame
                if (!silenceTimeout) {
                    document.getElementById('status-light').style.background = "#334155"; // Hall
                    silenceTimeout = setTimeout(() => {
                        silenceTimeout = null;
                    }, 1200);
                }
            }
            document.getElementById('s-val').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('v-val').innerText = Math.round(silenceMs/1000) + "s";
        };

        mediaRecorder.start(100); // Küsime andmeid iga 0.1s järel
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
            if (chunks.length > 5) { // Salvestame ainult siis, kui on reaalselt heli (vähemalt 0.5s)
                let finalHz = pitchHistory.length > 0 ? Math.round(pitchHistory.reduce((a,b)=>a+b)/pitchHistory.length) : 0;
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const tx = db.transaction("log", "readwrite");
                    tx.objectStore("log").add({ 
                        id: Date.now(), start: sessionStartTime, end: endTime, 
                        audio: reader.result, avgHz: finalHz, note: note 
                    });
                    tx.oncomplete = () => { renderHistory(); if(callback) callback(); };
                };
            } else if(callback) callback();
        };
        mediaRecorder.stop();
    } else if (callback) callback();
}

// 5. NUPUD
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('start-section').classList.add('hidden');
    document.getElementById('mic-section').classList.remove('hidden');
    startApp();
});

document.getElementById('toggleNoteBtn').addEventListener('click', () => {
    const container = document.getElementById('note-container');
    const btn = document.getElementById('toggleNoteBtn');
    container.classList.toggle('hidden');
    btn.innerText = container.classList.contains('hidden') ? "+ Lisa märge" : "Sule märge";
});

document.getElementById('fixBtn').addEventListener('click', () => {
    saveSegment(() => {
        chunks = []; preBuffer = []; speechMs = 0; silenceMs = 0; pitchHistory = [];
        document.getElementById('session-note').value = "";
        document.getElementById('note-container').classList.add('hidden');
        document.getElementById('toggleNoteBtn').innerText = "+ Lisa märge";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        mediaRecorder.start(100);
    });
});

document.getElementById('stopBtn').addEventListener('click', () => {
    if (confirm("Lõpeta sessioon?")) { 
        isLive = false; if(wakeLock) wakeLock.release(); 
        saveSegment(() => { setTimeout(() => location.reload(), 500); }); 
    }
});

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").getAll().onsuccess = e => {
        const items = e.target.result.sort((a,b) => b.id - a.id);
        const list = document.getElementById('history-list');
        list.innerHTML = items.map(s => `
            <div class="glass rounded-[30px] p-6 border border-white/5 mb-4 shadow-xl">
                <div class="flex justify-between text-[10px] text-slate-500 font-bold mb-4 uppercase">
                    <span>${s.start} — ${s.end}</span>
                    <button onclick="del(${s.id})" class="text-red-900/50 hover:text-red-500">Kustuta</button>
                </div>
                ${s.note ? `<div class="mb-4 p-4 bg-black/40 rounded-xl text-xs text-slate-300 italic border-l border-blue-500">${s.note}</div>` : ''}
                <div class="flex items-center gap-4">
                    <audio controls src="${s.audio}" class="flex-1 h-8 opacity-60"></audio>
                    <button onclick="fullDownload(${s.id})" class="text-blue-400 text-[10px] font-bold uppercase">Lata</button>
                </div>
            </div>`).join('');
    };
}

window.del = id => { if(confirm("Kustuta?")) { const tx = db.transaction("log", "readwrite"); tx.objectStore("log").delete(id); tx.oncomplete = renderHistory; } };

window.fullDownload = id => {
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").get(id).onsuccess = e => {
        const d = e.target.result;
        const html = `<html><body style="background:#020617;color:white;padding:40px;font-family:sans-serif;"><h2>${d.start}</h2><p>${d.note || ''}</p><audio controls src="${d.audio}"></audio></body></html>`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], {type:'text/html'}));
        a.download = `Sessioon_${d.id}.html`; a.click();
    };
};
