let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], sessionStartTime = "", pitchHistory = [];

// 1. KELL
setInterval(() => { 
    const el = document.getElementById('clock');
    if(el) el.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS
const dbReq = indexedDB.open("Peegel_Final_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("log", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. ANALÜÜS JA PIDEV SALVESTUS
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
        
        setupRecorder();

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

            let isSpeech = volume > 2 && pitch > 50;
            if (isSpeech) {
                speechMs += 50; pitchHistory.push(pitch);
                document.getElementById('status-light').style.background = "#22c55e";
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
            }
            document.getElementById('s-val').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('v-val').innerText = Math.round(silenceMs/1000) + "s";
        };

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga seadmes."); }
}

function setupRecorder() {
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.start();
}

// 4. SALVESTAMINE
function saveSegment(callback) {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        const endTime = new Date().toLocaleTimeString('et-EE');
        const note = document.getElementById('session-note').value.trim();
        
        mediaRecorder.onstop = () => {
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
        };
        mediaRecorder.stop();
    } else { if(callback) callback(); }
}

// 5. NUPUD (EventListenerid on kindlamad kui onclick HTML-is)
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('start-section').classList.add('hidden');
    document.getElementById('mic-section').classList.remove('hidden');
    startApp();
});

document.getElementById('toggleNoteBtn').addEventListener('click', () => {
    const container = document.getElementById('note-container');
    const btn = document.getElementById('toggleNoteBtn');
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        btn.innerText = "Sule märge";
    } else {
        container.classList.add('hidden');
        btn.innerText = "+ Lisa märge";
    }
});

document.getElementById('fixBtn').addEventListener('click', () => {
    saveSegment(() => {
        speechMs = 0; silenceMs = 0; pitchHistory = [];
        document.getElementById('session-note').value = "";
        document.getElementById('note-container').classList.add('hidden');
        document.getElementById('toggleNoteBtn').innerText = "+ Lisa märge";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        setupRecorder();
    });
});

document.getElementById('stopBtn').addEventListener('click', () => {
    if (confirm("Lõpeta sessioon?")) { 
        isLive = false; if(wakeLock) wakeLock.release(); 
        saveSegment(() => { setTimeout(() => location.reload(), 500); }); 
    }
});

// 6. AJALUGU
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
                    <button onclick="fullDownload(${s.id})" class="text-blue-500 text-[10px] font-bold uppercase tracking-widest">Lata</button>
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
