let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], speechMap = [], pitchHistory = [];
let sessionStartTime = "", autoFixInterval;
let hzMin = Infinity, hzMax = 0;

// KELL
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// ANDMEBAAS
const dbReq = indexedDB.open("Peegel_Final_V23", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// START
document.getElementById('start-btn').onclick = async () => {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('active-session').classList.remove('hidden');
    
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(ctx.destination);

        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { 
            if (e.data.size > 0 && isLive) { 
                chunks.push({ blob: e.data, t: Date.now() }); 
            } 
        };

        processor.onaudioprocess = () => {
            if (!isLive) return;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const vol = data.reduce((a,b) => a+b) / data.length;
            
            let maxVal = -1, maxIdx = -1;
            for (let i = 0; i < data.length/2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
            const hz = Math.round(maxIdx * (ctx.sampleRate/2) / (data.length/2));

            if (hz > 40 && hz < 2000) {
                if (hz < hzMin) hzMin = hz;
                if (hz > hzMax) hzMax = hz;
                document.getElementById('hz-min-val').innerText = hzMin === Infinity ? 0 : hzMin;
                document.getElementById('hz-max-val').innerText = hzMax;
            }

            const t = Date.now();
            // LÄVI: vol > 2.5 on hääle tuvastus
            if (vol > 2.5 && hz > 50) { 
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
        autoFixInterval = setInterval(() => fixSession(), 600000); 
    } catch (err) { alert("Mikker ei käivinunud."); }
};

async function fixSession(callback) {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    const endTime = new Date().toLocaleTimeString('et-EE');
    const note = document.getElementById('note-input').value;
    
    // Lukustame andmed töötlemiseks
    const currentChunks = [...chunks];
    const currentMap = [...speechMap];
    const stats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };

    mediaRecorder.onstop = async () => {
        // TUGEVDATUD FILTREERIMINE: 
        // Võtame helitüki kaasa, kui 1 sekundi raadiuses on tuvastatud kõnet
        const cleanChunks = currentChunks.filter(c => {
            const hasSpeechNearby = currentMap.some(m => m.s && Math.abs(m.t - c.t) < 1000);
            return hasSpeechNearby;
        }).map(c => c.blob);

        const fullB = new Blob(currentChunks.map(c => c.blob), { type: 'audio/webm;codecs=opus' });
        const cleanB = new Blob(cleanChunks, { type: 'audio/webm;codecs=opus' });

        const fullBase = await toB64(fullB);
        const cleanBase = await toB64(cleanB);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(),
            start: sessionStartTime,
            end: endTime,
            hzMin: stats.min === Infinity ? 0 : stats.min, 
            hzMax: stats.max,
            note: note,
            audioFull: fullBase, audioClean: cleanBase,
            s: Math.round(stats.s/1000), v: Math.round(stats.v/1000)
        });

        tx.oncomplete = () => {
            renderHistory();
            // Reset
            chunks = []; speechMap = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
            document.getElementById('note-input').value = "";
            sessionStartTime = new Date().toLocaleTimeString('et-EE');
            if (isLive) mediaRecorder.start(100);
            if (callback) callback();
        };
    };
    mediaRecorder.stop();
}

function toB64(b) { return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); }); }

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        const container = document.getElementById('history-container');
        container.innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5">
                <div class="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                    <span>${s.start}-${s.end} | ${s.hzMin}-${s.hzMax}Hz</span>
                    <button onclick="delS(${s.id})" class="text-red-900 font-bold uppercase">Kustuta</button>
                </div>
                <div class="p-4 bg-green-500/5 rounded-2xl space-y-2 border border-green-500/10">
                    <p class="text-[9px] font-black text-green-400 uppercase tracking-widest">Puhas vestlus (${s.s}s)</p>
                    <audio src="${s.audioClean}" controls preload="auto"></audio>
                </div>
                <div class="opacity-30 p-2 space-y-1">
                    <p class="text-[8px] uppercase font-bold text-slate-400">Toores (+Vaikus ${s.v}s)</p>
                    <audio src="${s.audioFull}" controls preload="auto"></audio>
                </div>
                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-2 text-[9px] font-black uppercase text-slate-500 bg-white/5 rounded-xl">Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs italic text-slate-300 border-l-2 border-blue-600">${s.note || '...'}</div>
            </div>`).join('');
    };
}

window.dl = (d, n) => { const a = document.createElement('a'); a.href = d; a.download = `${n}.webm`; a.click(); };
window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };

document.getElementById('manual-fix').onclick = () => fixSession();
document.getElementById('stop-session').onclick = () => {
    if(confirm("Lõpeta?")) { isLive = false; clearInterval(autoFixInterval); if(wakeLock) wakeLock.release(); fixSession(() => location.reload()); }
};
