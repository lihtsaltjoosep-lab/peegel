let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, recognition;
let chunks = [], sessionStartTime = "", pitchHistory = [], wakeLock = null;

// 1. KELLA FUNKTSIOON
setInterval(() => { 
    const clockEl = document.getElementById('clock');
    if(clockEl) clockEl.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAASI ÜHENDUS
const dbReq = indexedDB.open("Peegel_Final_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("log", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. PÕHILOOGIKA JA ANALÜÜS
async function startApp() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        
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

            // Mikrofoni riba ja sagedus ekraanil
            document.getElementById('mic-bar').style.width = Math.min(volume * 5, 100) + "%";
            document.getElementById('hz-val').innerText = Math.round(pitch) + " Hz";

            // Vaikuse lõikamise reegel (volume > 3 loetakse hääleks)
            let isSpeech = volume > 3 && pitch > 50 && pitch < 1500;
            
            if (isSpeech) {
                speechMs += 50; 
                pitchHistory.push(pitch);
                if (mediaRecorder.state === "inactive") mediaRecorder.start();
                else if (mediaRecorder.state === "paused") mediaRecorder.resume();
            } else {
                silenceMs += 50;
                if (mediaRecorder.state === "recording") mediaRecorder.pause();
            }

            // Statistika uuendamine
            document.getElementById('s-val').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('v-val').innerText = Math.round(silenceMs/1000) + "s";
            let totalMin = (speechMs + silenceMs) / 60000;
            document.getElementById('buffer-bar').style.width = Math.min((totalMin / 90) * 100, 100) + "%";
            document.getElementById('buffer-text').innerText = Math.round(totalMin) + " / 90 min";
        };

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga mikrofoni käivitamisel."); }
}

// 4. SALVESTAMINE
function saveSegment(callback) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        const endTime = new Date().toLocaleTimeString('et-EE');
        const note = document.getElementById('session-note').value.trim();

        mediaRecorder.onstop = () => {
            let finalHz = pitchHistory.length > 0 ? Math.round(pitchHistory.reduce((a,b) => a+b) / pitchHistory.length) : 0;
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const tx = db.transaction("log", "readwrite");
                tx.objectStore("log").add({ 
                    id: Date.now(), 
                    start: sessionStartTime, 
                    end: endTime, 
                    audio: reader.result, 
                    avgHz: finalHz,
                    note: note,
                    stats: { speech: speechMs, silence: silenceMs }
                });
                tx.oncomplete = () => { renderHistory(); if (callback) callback(); };
            };
        };
        mediaRecorder.stop();
    } else if (callback) callback();
}

// 5. NUPPUDE TEGEVUSED
document.getElementById('startBtn').onclick = () => {
    document.getElementById('start-section').classList.add('hidden');
    document.getElementById('mic-section').classList.remove('hidden');
    startApp();
};

document.getElementById('fixBtn').onclick = () => {
    saveSegment(() => {
        chunks = []; speechMs = 0; silenceMs = 0; pitchHistory = [];
        document.getElementById('session-note').value = "";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
    });
};

document.getElementById('stopBtn').onclick = () => {
    if (confirm("Lõpeta ja salvesta sessioon?")) { 
        isLive = false; if (wakeLock) wakeLock.release();
        saveSegment(() => { setTimeout(() => { location.reload(); }, 1000); }); 
    }
};

// 6. AJALOO KUVAMINE
function renderHistory() {
    if(!db) return;
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").getAll().onsuccess = e => {
        const items = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-list').innerHTML = items.map(s => `
            <div class="glass rounded-[30px] p-6 mb-4 border border-white/5">
                <div class="flex justify-between text-[10px] text-slate-500 font-bold uppercase mb-2">
                    <span>${s.start} — ${s.end}</span>
                    <button onclick="del(${s.id})" class="opacity-40">🗑️</button>
                </div>
                ${s.note ? `<div class="mb-3 p-3 bg-blue-500/5 rounded-xl border-l-2 border-blue-500 text-[11px] text-slate-300 italic">${s.note}</div>` : ''}
                <div class="text-blue-400 font-bold text-[10px] mb-3">${s.avgHz} Hz</div>
                <div class="flex gap-2 mb-4">
                    <button onclick="fullDownload(${s.id})" class="flex-1 bg-blue-600/10 text-blue-400 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest">Download</button>
                </div>
                <audio controls src="${s.audio}" class="w-full h-8 opacity-60"></audio>
            </div>`).join('');
    };
}

// 7. ABI-FUNKTSIOONID (Kustutamine ja Download)
window.del = id => { if(confirm("Kustuta?")) { const tx = db.transaction("log", "readwrite"); tx.objectStore("log").delete(id); tx.oncomplete = renderHistory; } };

window.fullDownload = id => {
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").get(id).onsuccess = e => {
        const d = e.target.result;
        const html = `<html><body style="background:#020617;color:white;padding:40px;font-family:sans-serif;">
            <h2 style="color:#3b82f6;">Analüüs: ${d.start} - ${d.end}</h2>
            <div style="background:#1e293b;padding:20px;border-radius:15px;margin-bottom:20px;">
                <p><b>Sagedus:</b> ${d.avgHz} Hz</p>
                <p><b>Märge:</b> ${d.note || '-'}</p>
                <p><b>Kõne:</b> ${Math.round(d.stats.speech/1000)}s | <b>Vaikus:</b> ${Math.round(d.stats.silence/1000)}s</p>
            </div>
            <audio controls src="${d.audio}" style="width:100%"></audio>
        </body></html>`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([html], {type:'text/html'}));
        a.download = `Sessioon_${d.start.replace(/:/g,'-')}.html`;
        a.click();
    };
};
