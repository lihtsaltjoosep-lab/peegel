// Globaalsed muutujad, mis nullitakse alati
let isLive = false, speechMs = 0, silenceMs = 0, db = null, stream = null;
let rawRecorder = null, audioCtx = null, processor = null, source = null;
let speechBuffer = [], rawChunks = [], hzMin = Infinity, hzMax = 0, sessionStartTime = "";

// KELL (Alati töötab)
setInterval(() => { 
    const c = document.getElementById('clock');
    if(c) c.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// ANDMEBAAS (Uus puhas nimi)
const dbReq = indexedDB.open("Peegel_V42_Final", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// START NUPP
document.getElementById('start-btn').addEventListener('click', async () => {
    console.log("Start nuppu vajutati");
    try {
        // 1. Küsime mikrofoni luba
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // 2. Lülitame ekraanid
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        
        // 3. Paneme püsti helimootori
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        processor = audioCtx.createScriptProcessor(4096, 1, 1);

        source.connect(analyser);
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

            const isSpeaking = vol > 2.5 && hz > 50;
            if (isSpeaking) {
                speechMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#22c55e";
                speechBuffer.push(new Float32Array(inputData));
            } else {
                silenceMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#334155";
            }
            
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        // 4. Toores salvesti
        rawRecorder = new MediaRecorder(stream);
        rawRecorder.ondataavailable = e => { if (e.data.size > 0) rawChunks.push(e.data); };
        rawRecorder.start();

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        console.log("Mootorid käivitatud");

    } catch (err) { 
        console.error("Viga käivitusel:", err);
        alert("Mikrofoni ei leitud või luba puudub."); 
    }
});

// FIKSEERI
async function fixSession() {
    if (!isLive) return;
    console.log("Fikseerin...");

    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime;
    const snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
    const currentSpeech = [...speechBuffer];
    const currentRaw = [...rawChunks];
    const currentSR = audioCtx.sampleRate;

    // NULLIME PUHVRID
    speechBuffer = []; rawChunks = [];
    speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
    document.getElementById('note-input').value = "";
    sessionStartTime = new Date().toLocaleTimeString('et-EE');

    // Salvestame
    const fullBlob = new Blob(currentRaw, { type: 'audio/webm' });
    const cleanWav = bufferToWav(currentSpeech, currentSR);

    const fullBase = await toB64(fullBlob);
    const cleanBase = await toB64(cleanWav);

    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").add({
        id: Date.now(), start: snapStart, end: snapEnd,
        hzMin: snapStats.min, hzMax: snapStats.max,
        note: snapNote, audioFull: fullBase, audioClean: cleanBase,
        s: Math.round(snapStats.s/1000), v: Math.round(snapStats.v/1000)
    });

    tx.oncomplete = () => {
        renderHistory();
        if (rawRecorder.state !== "inactive") {
            rawRecorder.stop();
            rawRecorder.start();
        }
    };
}

// ABI: WAV loomine
function bufferToWav(chunks, sampleRate) {
    const length = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 32 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeString(36, 'data');
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
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5 text-left">
                <div class="flex justify-between text-[10px] font-bold uppercase tracking-tight">
                    <span>
                        <span class="text-fix-orange">${s.start}-${s.end}</span>
                        <span class="text-divider"> | </span>
                        <span class="text-hz-blue">${s.hzMin}-${s.hzMax} Hz</span>
                        <span class="text-divider"> | </span>
                        <span class="text-silence-red">V: ${s.v}s</span>
                    </span>
                    <button onclick="delS(${s.id})" class="btn-delete-dark">KUSTUTA</button>
                </div>
                <div class="p-4 bg-green-500/5 rounded-2xl space-y-3 border border-green-500/10">
                    <div class="flex justify-between items-center text-[9px] font-black text-green-400 uppercase tracking-widest">
                        <span>Puhas vestlus (${s.s}s)</span>
                        <button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')" class="text-green-400 border border-green-400/20 px-2 py-0.5 rounded">Download</button>
                    </div>
                    <audio src="${s.audioClean}" controls preload="metadata"></audio>
                </div>
                <div class="opacity-10 p-2"><audio src="${s.audioFull}" controls></audio></div>
                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-3 text-[10px] font-black uppercase text-fix-orange bg-yellow-500/10 rounded-2xl">Kuva Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs italic text-slate-300 border-l-2 border-yellow-500">${s.note || '...'}</div>
            </div>`).join('');
    };
}

window.dl = (d, n) => { const a = document.createElement('a'); a.href = d; a.download = `${n}.wav`; a.click(); };
window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };

document.getElementById('manual-fix').onclick = () => fixSession();

document.getElementById('stop-session').onclick = () => { 
    if(confirm("Lõpeta sessioon?")) {
        isLive = false;
        location.reload(); 
    } 
};
