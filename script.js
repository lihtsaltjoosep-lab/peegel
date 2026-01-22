let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let fullChunks = [], cleanChunks = [], speechMap = [], pitchHistory = [];
let sessionStartTime = "", autoFixInterval;
let hzMin = Infinity, hzMax = 0;
let isSpeakingGlobal = false;

setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

const dbReq = indexedDB.open("Peegel_V30_DB", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

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
        ctx.createMediaStreamSource(stream).connect(analyser).connect(processor);
        processor.connect(ctx.destination);

        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = e => { 
            if (e.data.size > 0 && isLive) {
                // Lisame alati täispikka puhvrisse
                fullChunks.push(e.data);
                
                // PUHAS FILTRU: Lisame puhtasse massiivi andmeid AINULT siis, kui räägitakse
                if (isSpeakingGlobal) {
                    cleanChunks.push(e.data);
                }
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

            // TUNDLIKKUSE KONTROLL
            isSpeakingGlobal = (vol > 2.8 && hz > 50);
            
            if (isSpeakingGlobal) {
                speechMs += 50;
                document.getElementById('status-light').style.background = "#22c55e";
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
            }
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        mediaRecorder.start(100); // 100ms tükid võimaldavad reaalajas filtreerimist
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        autoFixInterval = setInterval(() => fixSession(), 600000); 
    } catch (err) { alert("Mikker ei käivitu."); }
};

async function fixSession(callback) {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime;
    const snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
    const finalFull = [...fullChunks];
    const finalClean = [...cleanChunks];

    mediaRecorder.onstop = async () => {
        // RESET
        fullChunks = []; cleanChunks = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        document.getElementById('note-input').value = "";
        if (isLive) mediaRecorder.start(100);

        const fullBlob = new Blob(finalFull, { type: 'audio/webm' });
        const cleanBlob = finalClean.length > 0 ? new Blob(finalClean, { type: 'audio/webm' }) : null;

        const fullBase = await toB64(fullBlob);
        const cleanBase = cleanBlob ? await toB64(cleanBlob) : null;

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(), start: snapStart, end: snapEnd,
            hzMin: snapStats.min === Infinity ? 0 : snapStats.min, hzMax: snapStats.max,
            note: snapNote, audioFull: fullBase, audioClean: cleanBase,
            s: Math.round(snapStats.s/1000), v: Math.round(snapStats.v/1000)
        });
        tx.oncomplete = () => { renderHistory(); if (callback) callback(); };
    };
    mediaRecorder.stop();
}

function toB64(b) { return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); }); }

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5">
                <div class="flex justify-between text-[10px] font-bold uppercase">
                    <span>
                        <span class="text-time-green">${s.start}-${s.end}</span>
                        <span class="text-divider"> | </span>
                        <span class="text-hz-cyan">${s.hzMin}-${s.hzMax} Hz</span>
                        <span class="text-divider"> | </span>
                        <span class="text-silence-red">V: ${s.v}s</span>
                    </span>
                    <button onclick="delS(${s.id})" class="btn-delete">KUSTUTA</button>
                </div>
                
                <div class="p-4 bg-green-500/5 rounded-2xl space-y-2 border border-green-500/10">
                    <div class="flex justify-between items-center text-[9px] font-black text-green-400 uppercase tracking-widest">
                        <span>Puhas vestlus (${s.s}s)</span>
                        <button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')" class="text-green-400 border border-green-400/20 px-2 py-0.5 rounded">Lata .webm</button>
                    </div>
                    ${s.audioClean ? `<audio src="${s.audioClean}" controls preload="metadata"></audio>` : '<p class="text-[8px] text-slate-600 uppercase">Heli ei tuvastatud</p>'}
                </div>

                <div class="opacity-10 p-2 space-y-1">
                    <p class="text-[8px] uppercase font-bold text-slate-400">Toores puhver (Täispikkus)</p>
                    <audio src="${s.audioFull}" controls preload="metadata"></audio>
                </div>

                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-3 text-[10px] font-black uppercase text-yellow-500 bg-yellow-500/10 rounded-2xl">Kuva Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs italic text-slate-300 border-l-2 border-yellow-500">${s.note || '...'}</div>
            </div>`).join('');
    };
}

window.dl = (d, n) => { const a = document.createElement('a'); a.href = d; a.download = `${n}.webm`; a.click(); };
window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };

document.getElementById('manual-fix').onclick = () => fixSession();
document.getElementById('stop-session').onclick = () => {
    if(confirm("Lõpeta?")) { isLive = false; clearInterval(autoFixInterval); if(wakeLock) wakeLock.release(); fixSession(() => location.reload()); }
};
