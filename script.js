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

const dbReq = indexedDB.open("Peegel_Final_V56", 1);
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
    } catch (err) { alert("Viga mikkriga!"); }
}

async function stopAndSave() {
    if (!isLive) return;
    document.getElementById('stop-btn').innerText = "SALVESTAN...";
    isLive = false;
    clearInterval(autoFixTimer);
    if (speechBuffer.length > 0) await fixSession();
    if (stream) stream.getTracks().forEach(t => t.stop());
    location.reload();
}

function fixSession() {
    return new Promise((resolve) => {
        if (!isLive && speechBuffer.length === 0) return resolve();
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

// ABI: Luuakse puhas tekstifaili sisu
function createInfoText(s) {
    return `PEEGEL SESSIOON\r\n` +
           `Kuupäev: ${s.date}\r\n` +
           `Aeg: ${s.start} - ${s.end}\r\n` +
           `Sagedus: ${s.hzMin} - ${s.hzMax} Hz\r\n` +
           `Vestlus: ${formatTime(s.sMs)}\r\n` +
           `Pausid: ${formatTime(s.vMs)}\r\n\r\n` +
           `MÄRKMED:\r\n${s.note || 'Märkmed puuduvad'}`;
}

// UUS: ZIP-faili allalaadimine (Heli + Tekst)
async function dlZip(id) {
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").get(id).onsuccess = async (e) => {
        const s = e.target.result;
        const zip = new JSZip();
        const fileNameBase = `Peegel_${s.date}_${s.start.replace(/:/g, '-')}`;
        
        // 1. Lisa heli
        const audioBlob = await fetch(s.audioClean).then(r => r.blob());
        zip.file(`${fileNameBase}.wav`, audioBlob);
        
        // 2. Lisa tekst
        zip.file(`${fileNameBase}_info.txt`, createInfoText(s));
        
        // 3. Genereeri ja laadi alla
        zip.generateAsync({type:"blob"}).then(function(content) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${fileNameBase}.zip`;
            link.click();
        });
    };
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

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5 text-left mb-4">
                <div class="flex justify-between items-center text-[11px] uppercase tracking-tight font-bold">
                    <span class="flex gap-2 items-center">
                        <span style="color: #22c55e;">${s.start}-${s.end}</span>
                        <span style="color: #334155;">|</span>
                        <span style="color: #3b82f6;">${s.hzMin}-${s.hzMax} <span style="color: #67e8f9; font-weight: 400;">HZ</span></span>
                        <span style="color: #334155;">|</span>
                        <span style="color: #f59e0b;">P:${formatTime(s.vMs)}</span>
                    </span>
                    <button onclick="delS(${s.id})" style="color: #991b1b; font-weight: 800; font-size: 10px;">KUSTUTA</button>
                </div>
                <div class="p-4 bg-blue-500/5 rounded-2xl space-y-3 border border-blue-500/10">
                    <div class="flex justify-between items-center text-[9px] font-black text-blue-400 uppercase tracking-widest">
                        <span>Puhas vestlus (${formatTime(s.sMs)})</span>
                        <button onclick="dlZip(${s.id})" class="text-blue-400 border border-blue-400/20 px-2 py-0.5 rounded">Download ZIP</button>
                    </div>
                    <audio src="${s.audioClean}" controls preload="metadata"></audio>
                </div>
                ${s.note && s.note.trim() !== "" ? `
                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-3 text-[10px] font-black uppercase bg-blue-500/10 rounded-2xl" style="color: #3b82f6;">Kuva Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs italic text-slate-300 border-l-2 border-blue-500">${s.note}</div>
                ` : ''}
            </div>`).join('');
    };
}

window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };
