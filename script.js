let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, recognition;
let chunks = [], sessionStartTime = "", currentTranscript = "", resultOffset = 0, autoFixInterval = null;
let pitchHistory = [], wakeLock = null, isRecordingHeli = false, silenceTimer = null;

// 1. KELL JA LUKUSTAMINE
setInterval(() => { 
    const clockEl = document.getElementById('clock');
    if(clockEl) clockEl.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

window.lockScreen = () => { document.getElementById('blackout').style.display = 'flex'; };
window.unlockScreen = () => { document.getElementById('blackout').style.display = 'none'; };

// 2. ANDMEBAAS (V14.1)
const dbReq = indexedDB.open("Peegel_Data_V14_1", 1);
dbReq.onupgradeneeded = e => e.target.result.createObjectStore("log", { keyPath: "id" });
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. WAKE LOCK (Hoiab ekraani sees)
async function requestWakeLock() {
    try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    } catch (err) { console.log("Wake Lock viga: " + err.message); }
}

// 4. PÕHILOOGIKA
async function startApp() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await requestWakeLock();

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
            const typeEl = document.getElementById('sound-type');

            if (isSpeech) {
                typeEl.innerText = "Salvestan..."; typeEl.className = "text-green-400 font-bold";
                pitchHistory.push(pitch); speechMs += 50;
                if (!isRecordingHeli) {
                    if (mediaRecorder.state === "inactive") mediaRecorder.start(100);
                    else if (mediaRecorder.state === "paused") mediaRecorder.resume();
                    isRecordingHeli = true;
                }
                if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
            } else {
                typeEl.innerText = volume > 10 ? "Müra" : "Vaikus"; typeEl.className = "text-slate-500";
                silenceMs += 50;
                if (isRecordingHeli && !silenceTimer) {
                    silenceTimer = setTimeout(() => {
                        if (mediaRecorder.state === "recording") mediaRecorder.pause();
                        isRecordingHeli = false;
                        silenceTimer = null;
                    }, 2000); 
                }
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
                let fullText = "";
                for (let i = resultOffset; i < e.results.length; i++) { fullText += e.results[i][0].transcript + " "; }
                currentTranscript = fullText.trim();
                document.getElementById('live-transcript').innerText = currentTranscript || "...";
                recognition.lastIdx = e.results.length;
            };
            recognition.onend = () => { if (isLive) recognition.start(); };
            recognition.start();
        }

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        autoFixInterval = setInterval(() => { handleFix(); }, 600000);
    } catch (err) { alert("Viga mikrofoni käivitamisel."); }
}

function handleStart() {
    document.getElementById('startBtn').classList.add('hidden');
    document.getElementById('activeControls').classList.remove('hidden');
    document.getElementById('mic-container').classList.remove('hidden');
    startApp();
}

function handleFix() {
    saveSegment(() => {
        if (recognition && recognition.lastIdx) resultOffset = recognition.lastIdx;
        chunks = []; currentTranscript = ""; speechMs = 0; silenceMs = 0;
        document.getElementById('live-transcript').innerText = "...";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        pitchHistory = [];
    });
}

function saveSegment(callback) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        const endTime = new Date().toLocaleTimeString('et-EE');
        mediaRecorder.stop();
        let finalHz = pitchHistory.length > 0 ? Math.round(pitchHistory.reduce((a,b) => a+b) / pitchHistory.length) : 0;
        
        // Ootame 500ms, et chunks täituks
        setTimeout(() => {
            const txt = document.getElementById('live-transcript').innerText.trim();
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const tx = db.transaction("log", "readwrite");
                tx.objectStore("log").add({ id: Date.now(), start: sessionStartTime, end: endTime, text: txt, audio: reader.result, avgHz: finalHz });
                tx.oncomplete = () => { 
                    console.log("Salvestatud mällu.");
                    if (callback) callback(); 
                };
            };
        }, 500);
    } else if (callback) callback();
}

// --- PARANDATUD HANDLESTOP ---
function handleStop() {
    if (confirm("Lõpeta sessioon ja salvesta mällu?")) { 
        isLive = false; 
        if (wakeLock) { wakeLock.release(); wakeLock = null; }
        clearInterval(autoFixInterval); 
        
        document.getElementById('live-transcript').innerText = "Salvestan viimast osa, oota...";

        saveSegment(() => { 
            // Ootame 1 sekundi, et IndexedDB jõuaks operatsiooni lõpetada
            setTimeout(() => { 
                location.reload(); 
            }, 1000); 
        }); 
    }
}

document.getElementById('startBtn').onclick = handleStart;
document.getElementById('fixBtn').onclick = handleFix;
document.getElementById('stopBtn').onclick = handleStop;

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").getAll().onsuccess = e => {
        const items = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-list').innerHTML = items.map(s => `
            <div class="glass p-5 rounded-3xl space-y-4 border border-slate-800 shadow-lg">
                <div class="flex justify-between items-center text-[10px] font-bold text-slate-500">
                    <span>${s.start} — ${s.end}</span>
                    <button onclick="del(${s.id})" class="text-red-900/50 hover:text-red-500">🗑️</button>
                </div>
                <div class="text-blue-400 font-bold text-xs">Keskmine: ${s.avgHz} Hz</div>
                <div class="flex gap-2">
                    <button onclick="fullDownload(${s.id})" class="flex-1 bg-blue-600/20 text-blue-400 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-blue-500/20">Download</button>
                    <button onclick="showText(${s.id}, this)" class="flex-1 bg-slate-800/50 text-slate-400 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/5">Text</button>
                </div>
                <div id="cont-${s.id}" class="hidden bg-black/60 p-4 rounded-xl text-sm italic text-slate-400 border-l-2 border-blue-600 leading-relaxed font-serif"></div>
                <audio controls src="${s.audio}" class="w-full h-8 opacity-80 contrast-125"></audio>
            </div>`).join('');
    };
}

window.del = id => { if(confirm("Kustuta see klipp?")) { const tx = db.transaction("log", "readwrite"); tx.objectStore("log").delete(id); tx.oncomplete = () => renderHistory(); } };
window.showText = (id, btn) => {
    const el = document.getElementById(`cont-${id}`);
    if (el.classList.contains('hidden')) {
        const tx = db.transaction("log", "readonly");
        tx.objectStore("log").get(id).onsuccess = e => { el.innerText = e.target.result.text || "Tekst puudub."; el.classList.remove('hidden'); btn.innerText = "Hide"; };
    } else { el.classList.add('hidden'); btn.innerText = "Text"; }
};
window.fullDownload = (id) => {
    const tx = db.transaction("log", "readonly");
    tx.objectStore("log").get(id).onsuccess = e => {
        const d = e.target.result;
        const html = `<html><body style="background:#020617;color:white;font-family:sans-serif;padding:40px;">
            <h2 style="color:#60a5fa">${d.start} - ${d.end}</h2>
            <p style="background:#1e293b; padding:10px; border-radius:8px; display:inline-block;">KESKMINE SAGEDUS: ${d.avgHz} Hz</p>
            <br><audio controls src="${d.audio}" style="width:100%"></audio>
            <div style="margin-top:30px;font-style:italic;color:#cbd5e1;line-height:1.6;font-size:1.2rem;border-left:4px solid #3b82f6;padding-left:20px;">${d.text}</div>
        </body></html>`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
        a.download = `Analüüs_${d.start.replace(/:/g,'-')}.html`; a.click();
    };
};
