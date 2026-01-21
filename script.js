let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, recognition;
let chunks = [], sessionStartTime = "", pitchHistory = [], wakeLock = null;

// 1. KELL
setInterval(() => { 
    const clockEl = document.getElementById('clock');
    if(clockEl) clockEl.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS
const dbReq = indexedDB.open("Peegel_Final_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("log", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. PÕHILOOGIKA
async function startApp() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
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
            for (let i = 0; i < data.length / 2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
            const pitch = maxIdx * (ctx.sampleRate / 2) / (data.length / 2);

            document.getElementById('mic-bar').style.width = Math.min(volume * 4, 100) + "%";
            document.getElementById('hz-val').innerText = Math.round(pitch) + " Hz";

            let isSpeech = volume > 10 && pitch > 75 && pitch < 1000;
            if (isSpeech) {
                document.getElementById('sound-type').innerText = "Kõne..."; 
                speechMs += 50; pitchHistory.push(pitch);
                if (mediaRecorder.state === "inactive") mediaRecorder.start(100);
                else if (mediaRecorder.state === "paused") mediaRecorder.resume();
            } else {
                document.getElementById('sound-type').innerText = "Vaikus"; 
                silenceMs += 50;
                if (mediaRecorder.state === "recording") mediaRecorder.pause();
            }

            if(pitchHistory.length > 0) {
                let avg = pitchHistory.reduce((a,b) => a+b) / pitchHistory.length;
                document.getElementById('avg-hz-live').innerText = "KESK: " + Math.round(avg) + " Hz";
            }

            document.getElementById('s-val').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('v-val').innerText = Math.round(silenceMs/1000) + "s";
            let totalMin = (speechMs + silenceMs) / 60000;
            document.getElementById('buffer-bar').style.width = Math.min((totalMin / 90) * 100, 100) + "%";
            document.getElementById('buffer-text').innerText = Math.round(totalMin) + " / 90 min";
        };

        const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (Speech) {
            recognition = new Speech(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'et-EE';
            recognition.onresult = e => {
                let text = ""; for (let i = 0; i < e.results.length; i++) { text += e.results[i][0].transcript; }
                document.getElementById('live-transcript').innerText = text || "...";
            };
            recognition.onend = () => { if (isLive) recognition.start(); };
            recognition.start();
        }

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga seadmes."); }
}

function saveSegment(callback) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        const endTime = new Date().toLocaleTimeString('et-EE');
        mediaRecorder.stop();
        let finalHz = pitchHistory.length > 0 ? Math.round(pitchHistory.reduce((a,b) => a+b) / pitchHistory.length) : 0;
        setTimeout(() => {
            const txt = document.getElementById('live-transcript').innerText.trim();
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const tx = db.transaction("log", "readwrite");
                tx.objectStore("log").add({ id: Date.now(), start: sessionStartTime, end: endTime, text: txt, audio: reader.result, avgHz: finalHz });
                tx.oncomplete = () => { renderHistory(); if (callback) callback(); };
            };
        }, 500);
    } else if (callback) callback();
}

document.getElementById('startBtn').onclick = () => {
    document.getElementById('start-section').classList.add('hidden');
    document.getElementById('mic-section').classList.remove('hidden');
    startApp();
};

document.getElementById('fixBtn').onclick = () => {
    saveSegment(() => {
        chunks = []; speechMs = 0; silenceMs = 0; pitchHistory = [];
        document.getElementById('live-transcript').innerText = "...";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
    });
};

document.getElementById('stopBtn').onclick = () => {
    if (confirm("Lõpeta sessioon?")) { 
        isLive = false; if (wakeLock) wakeLock.release();
        saveSegment(() => { setTimeout(() => { location.reload(); }, 1000); }); 
    }
};

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").getAll().onsuccess = e => {
        const items = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-list').innerHTML = items.map(s => `
            <div class="glass rounded-[30px] p-6 space-y-4 mb-4 border border-white/5">
                <div class="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    <span>${s.start} — ${s.end}</span>
                    <button onclick="del(${s.id})">🗑️</button>
                </div>
                <div class="text-blue-400 font-bold text-xs tracking-tighter">${s.avgHz} Hz</div>
                <div class="flex gap-2">
                    <button onclick="fullDownload(${s.id})" class="flex-1 bg-blue-600/10 text-blue-400 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest">Download</button>
                    <button onclick="showText(${s.id}, this)" class="flex-1 bg-white/5 text-slate-400 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest">Text</button>
                </div>
                <div id="cont-${s.id}" class="hidden bg-black/40 p-4 rounded-xl text-sm italic text-slate-400"></div>
                <audio controls src="${s.audio}" class="w-full h-8 opacity-60"></audio>
            </div>`).join('');
    };
}

window.del = id => { if(confirm("Kustuta?")) { const tx = db.transaction("log", "readwrite"); tx.objectStore("log").delete(id); tx.oncomplete = renderHistory; } };
window.showText = (id, btn) => {
    const el = document.getElementById(`cont-${id}`);
    if (el.classList.contains('hidden')) {
        const tx = db.transaction("log", "readonly");
        tx.objectStore("log").get(id).onsuccess = e => { el.innerText = e.target.result.text || "Tekst puudub."; el.classList.remove('hidden'); btn.innerText = "Hide"; };
    } else { el.classList.add('hidden'); btn.innerText = "Text"; }
};
window.fullDownload = id => {
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").get(id).onsuccess = e => {
        const d = e.target.result;
        const html = `<html><body style="background:#020617;color:white;padding:40px;font-family:sans-serif;"><h2>${d.start}-${d.end} (${d.avgHz}Hz)</h2><audio controls src="${d.audio}"></audio><p>${d.text}</p></body></html>`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], {type:'text/html'}));
        a.download = `Sessioon_${d.id}.html`; a.click();
    };
};
