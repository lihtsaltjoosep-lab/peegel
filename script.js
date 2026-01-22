const VOLUME_THRESHOLD = 3.8; 
const MIN_HZ = 80;            
const AUTO_FIX_MS = 600000; 

let isLive = false, speechMs = 0, silenceMs = 0, db, stream = null;
let audioCtx = null, processor = null, source = null, speechBuffer = [];
let hzMin = Infinity, hzMax = 0, sessionStartTime = "";
let autoFixTimer = null;

function formatTime(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m ${s}s`;
}

setInterval(() => { 
    const c = document.getElementById('clock');
    if(c) c.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// Andmebaas jääb samaks (v61), et vanad failid ei kaoks
const dbReq = indexedDB.open("Peegel_DataCapsule_V61", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

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
            
            // Siin otsustame, kas on kõne või vaikus
            if (vol > VOLUME_THRESHOLD && hz > MIN_HZ) {
                speechMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#22c55e"; // Roheline
                speechBuffer.push(new Float32Array(inputData));
            } else {
                silenceMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#334155"; // Hall
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

async function stopAndSave() {
    if (!isLive) return;
    document.getElementById('stop-btn').innerText = "SALVESTAN...";
    isLive = false;
    clearInterval(autoFixTimer);
    
    // Proovime salvestada viimast juppi
    await fixSession();
    
    if (stream) stream.getTracks().forEach(t => t.stop());
    location.reload();
}

function fixSession() {
    return new Promise((resolve) => {
        // --- UUS KONTROLL v64 ---
        // Kui kõne pikkus (speechMs) on 0 või puhver tühi, siis ÄRA SALVESTA.
        // Lihtsalt puhastame muutujad ja lahkume.
        if (speechMs === 0 || speechBuffer.length === 0) {
            speechBuffer = [];
            speechMs = 0;
            silenceMs = 0;
            hzMin = Infinity; 
            hzMax = 0;
            // Kui kasutaja kirjutas märkme aga ei rääkinud, tühjendame ka selle, 
            // sest pole heli, millega seda siduda.
            document.getElementById('note-input').value = ""; 
            return resolve(); // Lahkume siit funktsioonist kohe
        }
        // -------------------------

        const snapNote = document.getElementById('note-input').value;
        const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
        const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
        const currentSpeech = [...speechBuffer], currentSR = audioCtx.sampleRate;
        
        // Nullime loendurid järgmise tsükli jaoks
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

function downloadCapsule(id) {
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").get(id).onsuccess = (e) => {
        const s = e.target.result;
        const htmlContent = `
        <!DOCTYPE html>
        <html lang="et">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Peegel Sessioon ${s.date}</title>
            <style>
                body { background: #0f172a; color: #e2e8f0; font-family: sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.6; }
                .card { background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 2rem; margin-bottom: 2rem; }
                h1 { color: #3b82f6; font-style: italic; text-transform: uppercase; margin-top: 0; }
                .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 2rem; }
                .stat-box { background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 10px; border-left: 3px solid #3b82f6; }
                .stat-label { font-size: 0.8rem; text-transform: uppercase; color: #94a3b8; font-weight: bold; display: block; }
                .stat-value { font-size: 1.2rem; font-weight: bold; color: white; }
                .notes-box { background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 10px; white-space: pre-wrap; font-family: monospace; border-left: 3px solid #f59e0b; }
                audio { width: 100%; margin-top: 1rem; filter: invert(1) brightness(0.8); }
                hr { border-color: rgba(255,255,255,0.1); margin: 2rem 0; }
            </style>
        </head>
        <body>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h1>Peegel Andmekapsel</h1>
                    <div style="text-align:right; font-size:0.9rem; color:#94a3b8;">${s.date}<br>${s.start} - ${s.end}</div>
                </div>
                <hr>
                <div class="stats-grid">
                    <div class="stat-box"><span class="stat-label" style="color:#22c55e">Kõne</span><span class="stat-value">${formatTime(s.sMs)}</span></div>
                    <div class="stat-box"><span class="stat-label" style="color:#f59e0b">Vaikus</span><span class="stat-value">${formatTime(s.vMs)}</span></div>
                    <div class="stat-box"><span class="stat-label" style="color:#3b82f6">Sagedus</span><span class="stat-value">${s.hzMin} - ${s.hzMax} Hz</span></div>
                     <div class="stat-box"><span class="stat-label">Kokku</span><span class="stat-value">${formatTime(s.sMs + s.vMs)}</span></div>
                </div>
                <h3>MÄRKMED</h3>
                <div class="notes-box">${s.note ? s.note : 'Märkmed puuduvad'}</div>
                <hr>
                <h3>HELI</h3>
                <audio controls src="${s.audioClean}"></audio>
            </div>
        </body>
        </html>`;
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Peegel_Kapsel_${s.date}_${s.start.replace(/:/g, '-')}.html`;
        link.click();
    };
}

// WAV faili allalaadimine
function downloadRawWav(audioData, id) {
    const link = document.createElement('a');
    link.href = audioData;
    link.download = `Peegel_Audio_${id}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        const html = list.map(s => {
            const noteHtml = s.note && s.note.trim() !== "" ? 
                `<button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-2 text-[10px] font-black uppercase bg-blue-500/10 rounded-xl hover:bg-blue-500/20 transition-all" style="color: #3b82f6;">Kuva Märge</button>
                 <div class="hidden p-4 bg-black/40 rounded-xl text-xs italic text-slate-300 border-l-2 border-blue-500 mt-2 whitespace-pre-wrap">${s.note}</div>` 
                : '';
            return `
            <div class="glass rounded-[30px] p-5 mb-4 text-left">
                <div class="flex justify-between items-center text-[11px] uppercase font-bold mb-3">
                    <span class="flex gap-2 items-center">
                        <span style="color: #22c55e;">${s.start}-${s.end}</span>
                        <span style="color: #3b82f6;">${s.hzMin}-${s.hzMax} HZ</span>
                        <span style="color: #f59e0b;">P:${formatTime(s.vMs)}</span>
                    </span>
                    <button onclick="delS(${s.id})" style="color: #991b1b; font-weight: 800;">KUSTUTA</button>
                </div>
                <div class="p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 mb-3">
                    <div class="flex justify-between items-center text-[9px] font-black text-blue-400 uppercase mb-2">
                        <span>Pikkus: ${formatTime(s.sMs)}</span>
                        <div class="flex gap-2">
                            <button onclick="downloadCapsule(${s.id})" class="text-white bg-blue-600 border-0 px-2 py-1 rounded shadow text-[9px] active:scale-95">HTML</button>
                            <button onclick="downloadRawWav('${s.audioClean}', '${s.id}')" class="text-white bg-slate-600 border-0 px-2 py-1 rounded shadow text-[9px] active:scale-95">WAV</button>
                        </div>
                    </div>
                    <audio src="${s.audioClean}" controls preload="metadata"></audio>
                </div>
                ${noteHtml}
            </div>`;
        }).join('');
        document.getElementById('history-container').innerHTML = html;
    };
}

window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };
