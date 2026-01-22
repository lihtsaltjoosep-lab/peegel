let isLive = false, speechMs = 0, silenceMs = 0, db, stream, wakeLock = null;
let rawRecorder, audioCtx, processor, source, speechBuffer = [];
let rawChunks = [], hzMin = Infinity, hzMax = 0, sessionStartTime = "";

// 1. KELL (Oranž, õhuke)
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS (Püsime V40 peal, aga lisame töökindlust)
const dbReq = indexedDB.open("Peegel_Pro_V40", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. START
document.getElementById('start-btn').onclick = async () => {
    // Kui eelmine kontekst jäi lahti, sulgeme selle
    if (audioCtx && audioCtx.state !== 'closed') await audioCtx.close();
    
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('active-session').classList.remove('hidden');
    
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        processor = audioCtx.createScriptProcessor(4096, 1, 1);

        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioCtx.destination);

        rawRecorder = new MediaRecorder(stream);
        rawRecorder.ondataavailable = e => { if (e.data.size > 0) rawChunks.push(e.data); };

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

        rawRecorder.start();
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga mikkriga!"); }
};

// 4. FIKSEERI (Puhastab ka mootori mälu)
async function fixSession(callback) {
    if (!isLive) return;
    isLive = false;
    
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
    const currentSpeechBuffer = [...speechBuffer];
    const currentRawChunks = [...rawChunks];

    rawRecorder.onstop = async () => {
        const fullBlob = new Blob(currentRawChunks, { type: 'audio/webm' });
        const cleanWavBlob = bufferToWav(currentSpeechBuffer, audioCtx.sampleRate);

        const fullBase = await toB64(fullBlob);
        const cleanBase = await toB64(cleanWavBlob);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(), start: snapStart, end: snapEnd,
            hzMin: snapStats.min, hzMax: snapStats.max,
            note: snapNote, audioFull: fullBase, audioClean: cleanBase,
            s: Math.round(snapStats.s/1000), v: Math.round(snapStats.v/1000)
        });

        tx.oncomplete = () => {
            // TÄIELIK PUHASTUS uueks ringiks
            speechBuffer = []; rawChunks = [];
            speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
            document.getElementById('note-input').value = "";
            renderHistory();
            if (callback) callback();
        };
    };

    // Peatame kõik voogud ja vabastame mikri
    rawRecorder.stop();
    if (processor) processor.disconnect();
    if (source) source.disconnect();
    stream.getTracks().forEach(track => track.stop());
}

function bufferToWav(chunks, sampleRate) {
    const length = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    writeString(0, 'RIFF');
    view.setUint32(4, 32 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
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

document.getElementById('manual-fix').onclick = () => fixSession(() => {
    // Pärast fikseerimist ei lae me tervet lehte uuesti, vaid lihtsalt lülitume tagasi reaalaja vaatesse
    // et hoida AudioContext puhtana
});

document.getElementById('stop-session').onclick = () => { 
    if(confirm("Lõpeta?")) { fixSession(() => location.reload()); } 
};
