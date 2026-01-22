let isLive = false, speechMs = 0, silenceMs = 0, db, stream, wakeLock = null;
let rawRecorder;
let rawChunks = [], cleanDataPool = []; 
let speechMap = [], hzMin = Infinity, hzMax = 0, sessionStartTime = "";

// 1. KELL (Oranž, õhuke)
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS (V39)
const dbReq = indexedDB.open("Peegel_Pro_V39", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. START
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

        // MOOTOR 1: TOORES SALVESTI (Salvestab kõike)
        rawRecorder = new MediaRecorder(stream);
        rawRecorder.ondataavailable = e => { if (e.data.size > 0) rawChunks.push(e.data); };

        // MOOTOR 2: PUHAS FILTRU (Tükeldab voo 100ms juppideks)
        const filterRecorder = new MediaRecorder(stream);
        filterRecorder.ondataavailable = e => {
            // Kontrollime, kas viimase 100ms jooksul räägiti
            // Kui jah, lisame selle tüki puhtasse massiivi
            const recentSpeech = speechMap.slice(-3).some(m => m.s);
            if (recentSpeech && isLive) {
                cleanDataPool.push(e.data);
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
                if (hz < hzMin) hzMin = hz; if (hz > hzMax) hzMax = hz;
                document.getElementById('hz-min-val').innerText = hzMin;
                document.getElementById('hz-max-val').innerText = hzMax;
            }

            const isSpeakingNow = vol > 2.8 && hz > 50;
            if (isSpeakingNow) {
                speechMs += 50;
                document.getElementById('status-light').style.background = "#22c55e";
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
            }
            
            speechMap.push({ s: isSpeakingNow });
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        rawRecorder.start();
        filterRecorder.start(100); // Saadab 100ms pikkuseid pakette kontrollimiseks
        
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Viga!"); }
};

// 4. FIKSEERI
async function fixSession(callback) {
    if (!rawRecorder || rawRecorder.state === "inactive") return;
    
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };

    rawRecorder.onstop = async () => {
        // Genereerime täiesti uue "Puhta" faili, kus puuduvad vaikuse ajad
        const fullBlob = new Blob(rawChunks, { type: 'audio/webm' });
        
        // Puhas fail luuakse ainult nendest bititükkidest, mis filtri läbisid
        // See eemaldab failist vaikuse ja ajatemplid, nii et pleier näeb lühikest faili.
        const cleanBlob = new Blob(cleanDataPool, { type: 'audio/webm' });

        const fullBase = await toB64(fullBlob);
        const cleanBase = await toB64(cleanBlob);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(), start: snapStart, end: snapEnd,
            hzMin: snapStats.min, hzMax: snapStats.max,
            note: snapNote, audioFull: fullBase, audioClean: cleanBase,
            s: Math.round(snapStats.s/1000), v: Math.round(snapStats.v/1000)
        });

        tx.oncomplete = () => {
            rawChunks = []; cleanDataPool = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0; speechMap = [];
            document.getElementById('note-input').value = "";
            renderHistory(); if (callback) callback();
        };
    };

    isLive = false;
    rawRecorder.stop();
}

function toB64(b) { return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); }); }

// 5. LOGI RENDERDAMINE (Värvid paigas)
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
                        <span class="text-silence-red uppercase">V: ${s.v}s</span>
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

window.dl = (d, n) => { const a = document.createElement('a'); a.href = d; a.download = `${n}.webm`; a.click(); };
window.delS = id => { if(confirm("Kustuta?")) { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id); tx.oncomplete = renderHistory; } };

document.getElementById('manual-fix').onclick = () => fixSession();
document.getElementById('stop-session').onclick = () => { if(confirm("Lõpeta?")) { isLive = false; fixSession(() => location.reload()); } };
