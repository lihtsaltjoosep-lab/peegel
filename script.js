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

            document.getElementById('mic-bar').style.width = Math.min(volume * 4, 100) + "%";
            document.getElementById('hz-val').innerText = Math.round(pitch) + " Hz";

            // LÄVI: volume > 3 ja sagedus 50-1500 Hz
            let isSpeech = volume > 3 && pitch > 50 && pitch < 1500;
            const typeEl = document.getElementById('sound-type');

            if (isSpeech) {
                typeEl.innerText = "Kõne..."; 
                typeEl.style.color = "#4ade80";
                speechMs += 50; 
                pitchHistory.push(pitch);

                // KUI ON KÕNE: Käivitame salvestamise, kui see seisis
                if (mediaRecorder.state === "inactive") {
                    mediaRecorder.start();
                } else if (mediaRecorder.state === "paused") {
                    mediaRecorder.resume();
                }
            } else {
                typeEl.innerText = "Vaikus"; 
                typeEl.style.color = "#64748b";
                silenceMs += 50;

                // KUI ON VAIKUS: Paneme salvestamise pausile (lõikame vaikuse välja)
                if (mediaRecorder.state === "recording") {
                    mediaRecorder.pause();
                }
            }

            // Statistika uuendamine ekraanil
            document.getElementById('s-val').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('v-val').innerText = Math.round(silenceMs/1000) + "s";
            
            if(pitchHistory.length > 0) {
                let avg = pitchHistory.reduce((a,b) => a+b) / pitchHistory.length;
                document.getElementById('avg-hz-live').innerText = "KESK: " + Math.round(avg) + " Hz";
            }
            
            let totalMin = (speechMs + silenceMs) / 60000;
            document.getElementById('buffer-bar').style.width = Math.min((totalMin / 90) * 100, 100) + "%";
            document.getElementById('buffer-text').innerText = Math.round(totalMin) + " / 90 min";
        };

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga seadmes: " + err.message); }
}

function saveSegment(callback) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        const endTime = new Date().toLocaleTimeString('et-EE');
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
                    stats: { speech: speechMs, silence: silenceMs }
                });
                tx.oncomplete = () => { renderHistory(); if (callback) callback(); };
            };
        };
        mediaRecorder.stop();
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
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
    });
};

document.getElementById('stopBtn').onclick = () => {
    if (confirm("Lõpeta sessioon?")) { 
        isLive = false; if (wakeLock) wakeLock.release();
        saveSegment(() => { setTimeout(() => { location.reload(); }, 1000); }); 
    }
}

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").getAll().onsuccess = e => {
        const items = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-list').innerHTML = items.map(s => `
            <div class="glass rounded-[30px] p-6 mb-4 border border-white/5">
                <div class="flex justify-between text-[10px] text-slate-500 font-bold uppercase mb-2">
                    <span>${s.start} — ${s.end}</span>
                    <button onclick="del(${s.id})">🗑️</button>
                </div>
                <div class="text-blue-400 font-bold text-xs mb-3 italic">${s.avgHz} Hz</div>
                <audio controls src="${s.audio}" class="w-full h-8 opacity-60"></audio>
            </div>`).join('');
    };
}

window.del = id => { if(confirm("Kustuta?")) { const tx = db.transaction("log", "readwrite"); tx.objectStore("log").delete(id); tx.oncomplete = renderHistory; } };
