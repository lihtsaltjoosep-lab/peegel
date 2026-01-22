let isLive = false, speechMs = 0, silenceMs = 0, db, stream, wakeLock = null;
let rawRecorder, cleanRecorder;
let rawChunks = [], cleanChunks = [], speechMap = [], hzMin = Infinity, hzMax = 0;
let sessionStartTime = "";

// 1. KELL (Oranž, õhuke)
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS (V37)
const dbReq = indexedDB.open("Peegel_Pro_V37", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. START - TOPELT MOOTORI KÄIVITUS
document.getElementById('start-btn').onclick = async () => {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('active-session').classList.remove('hidden');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        ctx.createMediaStreamSource(stream).connect(analyser).connect(processor);
        processor.connect(ctx.destination);

        // MOOTOR A: TOORES
        rawRecorder = new MediaRecorder(stream);
        rawRecorder.ondataavailable = e => { if (e.data.size > 0) rawChunks.push(e.data); };

        // MOOTOR B: PUHAS (Kasutame eraldi voogu, mida juhime käsitsi)
        const cleanStream = stream.clone();
        cleanRecorder = new MediaRecorder(cleanStream);
        cleanRecorder.ondataavailable = e => { if (e.data.size > 0) cleanChunks.push(e.data); };

        processor.onaudioprocess = () => {
            if (!isLive) return;
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const vol = data.reduce((a,b) => a+b) / data.length;
            
            // Hz Analüüs
            let maxVal = -1, maxIdx = -1;
            for (let i = 0; i < data.length/2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
            const hz = Math.round(maxIdx * (ctx.sampleRate/2) / (data.length/2));
            if (hz > 40 && hz < 2000) {
                if (hz < hzMin) hzMin = hz; if (hz > hzMax) hzMax = hz;
                document.getElementById('hz-min-val').innerText = hzMin;
                document.getElementById('hz-max-val').innerText = hzMax;
            }

            const isSpeaking = vol > 2.8 && hz > 50;
            
            // JUHTIMINE: Paneme puhta mootori pausile või käima reaalajas
            if (isSpeaking) {
                if (cleanRecorder.state === "paused") cleanRecorder.resume();
                speechMs += 50;
                document.getElementById('status-light').style.background = "#22c55e";
            } else {
                if (cleanRecorder.state === "recording") {
                    // Jätame 1.5s varu enne pausi, et jutt ei hakkiks
                    setTimeout(() => { if(!isSpeaking && cleanRecorder.state === "recording") cleanRecorder.pause(); }, 1500);
                }
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
            }
            
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        rawRecorder.start();
        cleanRecorder.start();
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga mikkriga!"); }
};

// 4. FIKSEERI
async function fixSession(callback) {
    if (!rawRecorder || rawRecorder.state === "inactive") return;
    
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };

    // Lõpetame mõlemad mootorid
    rawRecorder.onstop = async () => {
        const fullBlob = new Blob(rawChunks, { type: 'audio/webm' });
        const cleanBlob = new Blob(cleanChunks, { type: 'audio/webm' });

        const fullBase = await toB64(fullBlob);
        const cleanBase = await toB64(cleanBlob);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(), start: snapStart, end: snapEnd,
            hzMin: snapStats.min, hzMax: snapStats.max,
            note: snapNote, audioFull: fullBase, audioClean: cleanBase,
            s: snapStats.s, v: snapStats.v
        });

        tx.oncomplete = () => {
            rawChunks = []; cleanChunks = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
            document.getElementById('note-input').value = "";
            sessionStartTime = new Date().toLocaleTimeString('et-EE');
            if (isLive) { rawRecorder.start(); cleanRecorder.start(); }
            renderHistory(); if (callback) callback();
        };
    };

    isLive = false;
    rawRecorder.stop();
    cleanRecorder.stop();
}

function toB64(b) { return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); }); }

// 5. LOGI RENDERDAMINE (Värviparandused)
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
                        <span class="text-silence-red">V: ${Math.round(s.v/1000)}s</span>
                    </span>
                    <button onclick="delS(${s.id})" class="btn-delete-dark">KUSTUTA</button>
                </div>
                
                <div class="p-4 bg-green-500/5 rounded-2xl space-y-3 border border-green-500/10">
                    <div class="flex justify-between items-center text-[9px] font-black text-green-400 uppercase tracking-widest">
                        <span>Puhas vestlus (${Math.round(s.s/1000)}s)</span>
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

window.dl = (d, n) => { const a = document.createElement('a'); a.href = d; a.download = `${n}.webm`; a.click(); };
window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };

document.getElementById('manual-fix').onclick = () => fixSession();
document.getElementById('stop-session').onclick = () => { if(confirm("Lõpeta?")) { isLive = false; fixSession(() => location.reload()); } };
