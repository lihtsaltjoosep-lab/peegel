const VOLUME_THRESHOLD = 3.8; 
const MIN_HZ = 80;            
const AUTO_FIX_MS = 600000; 

let isLive = false, speechMs = 0, silenceMs = 0, db, stream = null;
let audioCtx = null, processor = null, source = null, speechBuffer = [];
let hzMin = Infinity, hzMax = 0, sessionStartTime = "";
let autoFixTimer = null;

// Kell
setInterval(() => { 
    const c = document.getElementById('clock');
    if(c) c.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// Aja vormindus
function formatTime(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m ${s}s`;
}

// Andmebaas
const dbReq = indexedDB.open("Peegel_Final_V58", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// START
async function startSession() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        source = audioCtx.createMediaStreamSource(stream);
        const filter = audioCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 100; 
        const analyser = audioCtx.createAnalyser();
        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        
        source.connect(filter);
        filter.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioCtx.destination);

        processor.onaudioprocess = (e) => {
            if (!isLive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const vol = data.reduce((a,b) => a+b) / data.length;
            let maxVal = -1, maxIdx = -1;
            for (let i = 0; i < data.length/2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
            const hz = Math.round(maxIdx * (audioCtx.sampleRate/2) / (data.length/2));
            
            if (hz > 40 && hz < 2000) {
                if (hz < hzMin) hzMin = hz; if (hz > hzMax) hzMax = hz;
                document.getElementById('hz-min-val').innerText = hzMin;
                document.getElementById('hz-max-val').innerText = hzMax;
            }
            if (vol > VOLUME_THRESHOLD && hz > MIN_HZ) {
                speechMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#22c55e";
                speechBuffer.push(new Float32Array(inputData));
            } else {
                silenceMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#334155";
            }
            document.getElementById('speech-sec').innerText = formatTime(speechMs);
            document.getElementById('silence-sec').innerText = formatTime(silenceMs);
        };

        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        autoFixTimer = setInterval(fixSession, AUTO_FIX_MS);
    } catch (err) { alert("Mikrofoni viga!"); }
}

// LÕPETAMINE JA SALVESTAMINE
async function stopAndSave() {
    if (!isLive) return;
    isLive = false;
    clearInterval(autoFixTimer);
    if (speechBuffer.length > 0) await fixSession();
    if (stream) stream.getTracks().forEach(t => t.stop());
    location.reload();
}

// FIKSEERIMINE
function fixSession() {
    return new Promise((resolve) => {
        if (speechBuffer.length === 0) return resolve();
        const snapNote = document.getElementById('note-input').value;
        const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
        const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
        const currentSpeech = [...speechBuffer], currentSR = audioCtx.sampleRate;
        
        speechBuffer = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
        document.getElementById('note-input').value = "";
        sessionStartTime = new Date().toLocaleTimeString('et-EE');

        const cleanWav = bufferToWav(currentSpeech, currentSR);
        toB64(cleanWav).then(cleanBase => {
            const tx = db.transaction("sessions", "readwrite");
            tx.objectStore("sessions").add({
                id: Date.now(), start: snapStart, end: snapEnd,
                date: new Date().toLocaleDateString('et-EE'),
                hzMin: snapStats.min, hzMax: snapStats.max,
                note: snapNote, audioClean: cleanBase,
                sMs: snapStats.s, vMs: snapStats.v
            });
            tx.oncomplete = () => { renderHistory(); resolve(); };
        });
    });
}

// WAV loomine
function bufferToWav(chunks, sampleRate) {
    const length = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeString(0, 'RIFF'); view.setUint32(4, 32 + length * 2, true); writeString(8, 'WAVE'); writeString(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    let offset = 44;
    for (let chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
            const s = Math.max(-1, Math.min(1, chunk[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

function toB64(b) { return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); }); }

// HTML FAILINIMEGA ALLALAADIMINE
function downloadSession(id) {
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").get(id).onsuccess = (e) => {
        const s = e.target.result;
        const htmlContent = `<html><body style="background:#020617;color:white;font-family:sans-serif;padding:40px;">
            <h2>PEEGEL SESSIOON</h2>
            <p>Kuupäev: ${s.date} | Aeg: ${s.start}-${s.end}</p>
            <p>Hz: ${s.hzMin}-${s.hzMax} | Vestlus: ${formatTime(s.sMs)} | Paus: ${formatTime(s.vMs)}</p>
            <hr style="opacity:0.2"><h3>MÄRKMED:</h3>
            <div style="background:rgba(255,255,255,0.05);padding:20px;border-radius:10px;white-space:pre-wrap;">${s.note || 'Märkmed puuduvad'}</div>
            <br><h3>HELI:</h3>
            <audio controls src="${s.audioClean}" style="width:100%"></audio>
        </body></html>`;
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Sessioon_${s.date}_${s.start.replace(/:/g, '-')}.html`;
        link.click();
    };
}

// LOGI KUVAMINE
function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 text-left mb-4">
                <div class="flex justify-between items-center text-[11px] uppercase font-bold mb-3">
                    <span class="flex gap-2 items-center">
                        <span style="color: #22c55e;">${s.start}-${s.end}</span>
                        <span style="color: #334155;">|</span>
                        <span style="color: #3b82f6;">${s.hzMin}-${s.hzMax} <span style="color: #67e8f9; font-weight:400">HZ</span></span>
                        <span style="color: #334155;">|</span>
                        <span style="color: #f59e0b;">P:${formatTime(s.vMs)}</span>
                    </span>
                    <button onclick="delS(${s.id})" style="color: #991b1b; font-weight: 800;">KUSTUTA</button>
                </div>
                <div class="p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 mb-3">
                    <div class="flex justify-between items-center text-[9px] font-black text-blue-400 uppercase mb-2">
                        <span>Vestlus: ${formatTime(s.sMs)}</span>
                        <button onclick="downloadSession(${s.id})" class="text-blue-400 border border-blue-400/20 px-2 py-1 rounded">Download HTML</button>
                    </div>
                    <audio src="${s.audioClean}" controls preload="metadata"></audio>
                </div>
                ${s.note && s.note.trim() !== "" ? `
                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-2 text-[10px] font-black uppercase bg-blue-500/10 rounded-xl" style="color: #3b82f6;">Kuva Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-xl text-xs italic text-slate-300 border-l-2 border-blue-500 mt-2">${s.note}</div>
                ` : ''}
            </div>`).join('');
    };
}

window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };
