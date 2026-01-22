let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], speechMap = [], hzMin = Infinity, hzMax = 0, sessionStartTime = "";

// KELL
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// ANDMEBAAS - Uus versioon andmete puhastamiseks
const dbReq = indexedDB.open("Peegel_Pro_V35", 1);
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
        ctx.createMediaStreamSource(stream).connect(analyser).connect(processor);
        processor.connect(ctx.destination);

        // Kasutame fikseeritud sämplimist, et lõikamine oleks võimalik
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
        mediaRecorder.ondataavailable = e => { 
            if (e.data.size > 0 && isLive) {
                // Lisame ajahetke igale tükile
                chunks.push({ data: e.data, t: Date.now() }); 
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

            const t = Date.now();
            const isSpeaking = vol > 2.8 && hz > 50;
            
            if (isSpeaking) {
                speechMs += 50;
                document.getElementById('status-light').style.background = "#22c55e";
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
            }
            // Märgime reaalajas üles iga 50ms oleku
            speechMap.push({ t: t, s: isSpeaking });
            
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        mediaRecorder.start(100); // Väikesed tükid on lõikamiseks hädavajalikud
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { alert("Mikker viga."); }
};

// FIKSEERI
async function fixSession(callback) {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
    const snapChunks = [...chunks], snapMap = [...speechMap];

    mediaRecorder.onstop = async () => {
        const fullBlob = new Blob(snapChunks.map(c => c.data), { type: 'audio/webm' });
        const fullBase = await toB64(fullBlob);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(), start: snapStart, end: snapEnd,
            hzMin: snapStats.min, hzMax: snapStats.max,
            note: snapNote, audioFull: fullBase, audioClean: null,
            s: Math.round(snapStats.s/1000), v: Math.round(snapStats.v/1000),
            rawChunks: snapChunks, rawMap: snapMap 
        });
        tx.oncomplete = () => {
            chunks = []; speechMap = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
            document.getElementById('note-input').value = "";
            sessionStartTime = new Date().toLocaleTimeString('et-EE');
            if (isLive) mediaRecorder.start(100);
            renderHistory(); if (callback) callback();
        };
    };
    mediaRecorder.stop();
}

// LÕIKAMISE NUPP - SEE ON NÜÜD UUENDATUD
async function processSilence(id) {
    const btn = document.getElementById(`proc-btn-${id}`);
    btn.innerText = "LÕIKAN...";
    btn.disabled = true;

    const tx = db.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    
    store.get(id).onsuccess = async (e) => {
        const s = e.target.result;
        
        // Leiame kõik tükid, mis on märgitud kõneks (kasutame 1.2s akent)
        const cleanData = s.rawChunks.filter(chunk => {
            return s.rawMap.some(map => map.s && Math.abs(map.t - chunk.t) < 1200);
        }).map(c => c.data);

        if (cleanData.length > 0) {
            // Kriitiline samm: Loome uue Blobi uue päisega
            const cleanBlob = new Blob(cleanData, { type: 'audio/webm;codecs=opus' });
            
            // Konverteerime base64-ks, et salvestada
            s.audioClean = await toB64(cleanBlob);
            
            const updateTx = db.transaction("sessions", "readwrite");
            updateTx.objectStore("sessions").put(s);
            updateTx.oncomplete = () => { renderHistory(); };
        } else {
            alert("Selles klipis pole piisavalt vestlust!");
            renderHistory();
        }
    };
}

function toB64(b) { return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(b); }); }

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 border border-white/5 shadow-xl text-left">
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
                        ${s.audioClean ? `
                            <button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')" class="text-green-400 border border-green-400/20 px-2 py-0.5 rounded">Download</button>
                        ` : `
                            <button id="proc-btn-${s.id}" onclick="processSilence(${s.id})" class="bg-blue-600/40 text-blue-200 px-3 py-1 rounded-lg">Eemalda vaikus</button>
                        `}
                    </div>
                    ${s.audioClean ? `<audio src="${s.audioClean}" controls preload="metadata"></audio>` : '<p class="text-[8px] text-slate-500 italic">Vajuta nuppu töötlemiseks</p>'}
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
