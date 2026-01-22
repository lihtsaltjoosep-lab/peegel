const AUTO_FIX_MS = 10 * 60 * 1000; 
let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], speechMap = [], pitchHistory = [];
let sessionStartTime = "", autoFixInterval;
let hzMin = Infinity, hzMax = 0;

setInterval(() => { 
    document.getElementById('clock').innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

const dbReq = indexedDB.open("Peegel_V22_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

async function startEngine() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyser.connect(processor); processor.connect(ctx.destination);

        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0 && isLive) { chunks.push({ blob: e.data, t: Date.now() }); } };

        processor.onaudioprocess = () => {
            if (!isLive) return;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const vol = data.reduce((a,b) => a+b) / data.length;
            
            let maxVal = -1, maxIdx = -1;
            for (let i = 0; i < data.length/2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
            const hz = Math.round(maxIdx * (ctx.sampleRate/2) / (data.length/2));

            if (hz > 40 && hz < 3000) {
                if (hz < hzMin) hzMin = hz;
                if (hz > hzMax) hzMax = hz;
                document.getElementById('hz-min').innerText = hzMin === Infinity ? 0 : hzMin;
                document.getElementById('hz-max').innerText = hzMax;
            }

            const t = Date.now();
            if (vol > 3.0 && hz > 50) {
                speechMs += 50;
                document.getElementById('status-light').style.background = "#22c55e";
                speechMap.push({ t: t, s: true });
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
                speechMap.push({ t: t, s: false });
            }
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        mediaRecorder.start(100);
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        autoFixInterval = setInterval(() => fixSession(), AUTO_FIX_MS);
    } catch (e) { alert("Mikrofoni viga!"); }
}

async function fixSession(callback) {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    const endTime = new Date().toLocaleTimeString('et-EE');
    const note = document.getElementById('note-input').value;
    const currentChunks = [...chunks];
    const currentMap = [...speechMap];
    const currentStats = { min: hzMin, max: hzMax, speech: speechMs, silence: silenceMs };

    mediaRecorder.onstop = async () => {
        // Vaikuse eemaldamine
        const cleanChunks = currentChunks.filter(chunk => {
            const mapPoint = currentMap.find(m => Math.abs(m.t - chunk.t) < 150);
            return mapPoint ? mapPoint.s : false;
        }).map(c => c.blob);

        const fullBlob = new Blob(currentChunks.map(c => c.blob), { type: 'audio/webm' });
        const cleanBlob = new Blob(cleanChunks, { type: 'audio/webm' });

        const fullBase64 = await b64(fullBlob);
        const cleanBase64 = await b64(cleanBlob);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(),
            start: sessionStartTime,
            end: endTime,
            hzMin: currentStats.min,
            hzMax: currentStats.max,
            note: note,
            audioFull: fullBase64,
            audioClean: cleanBase64,
            speechSec: Math.round(currentStats.speech/1000),
            silenceSec: Math.round(currentStats.silence/1000)
        });

        tx.oncomplete = () => {
            renderHistory();
            chunks = []; speechMap = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
            document.getElementById('note-input').value = "";
            sessionStartTime = new Date().toLocaleTimeString('et-EE');
            if (isLive) mediaRecorder.start(100);
            if (callback) callback();
        };
    };
    mediaRecorder.stop();
}

const b64 = b => new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); });

function renderHistory() {
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 border border-white/5 space-y-4">
                <div class="flex justify-between items-start text-[10px] font-bold uppercase text-slate-500">
                    <span>${s.start} — ${s.end} | <span class="text-blue-400">${s.hzMin}-${s.hzMax} Hz</span></span>
                    <button onclick="delS(${s.id})" class="text-red-900">Kustuta</button>
                </div>

                <div class="p-4 bg-black/20 rounded-2xl space-y-3">
                    <div class="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-green-400">
                        <span>Vestlus (${s.speechSec}s)</span>
                        <button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')">Lata .webm</button>
                    </div>
                    <audio src="${s.audioClean}" controls></audio>
                </div>

                <div class="opacity-40 p-3 bg-black/10 rounded-xl space-y-2">
                    <div class="flex justify-between items-center text-[8px] uppercase font-bold text-slate-400">
                        <span>Toores sessioon (${s.speechSec + s.silenceSec}s)</span>
                        <button onclick="dl('${s.audioFull}', 'Toores_${s.id}')">Lata</button>
                    </div>
                    <audio src="${s.audioFull}" controls></audio>
                </div>

                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-2 text-[9px] font-black uppercase text-slate-500 bg-white/5 rounded-xl">Kuva märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs text-slate-300 italic border-l-2 border-blue-500">${s.note || 'Pole märkmeid.'}</div>
            </div>
        `).join('');
    };
}

window.dl = (d, n) => { const a = document.createElement('a'); a.href = d; a.download = `${n}.webm`; a.click(); };
window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };

document.getElementById('start-btn').onclick = () => {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('active-session').classList.remove('hidden');
    startEngine();
};
document.getElementById('manual-fix').onclick = () => fixSession();
document.getElementById('stop-session').onclick = () => {
    if(confirm("Lõpeta?")) {
        isLive = false; clearInterval(autoFixInterval);
        fixSession(() => location.reload());
    }
};
