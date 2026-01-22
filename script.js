let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], speechMap = [], pitchHistory = [];
let sessionStartTime = "", autoFixInterval;
let hzMin = Infinity, hzMax = 0;

// KELL
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// ANDMEBAAS - Uus versioon, et vältida vanu konflikte
const dbReq = indexedDB.open("Peegel_V26_Final", 1);
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

        // Kasutame kindlat tüüpi, mida telefonid eelistavad
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
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
            if (vol > 2.2 && hz > 50) { 
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

        // Salvestame tihedalt (100ms), et lõikamine oleks täpne
        mediaRecorder.start(100); 
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        autoFixInterval = setInterval(() => fixSession(), 600000); 
    } catch (err) { alert("Viga mikkriga."); }
};

async function fixSession(callback) {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    
    // Võtame andmetest "pildi" enne peatamist
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime;
    const snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
    const snapChunks = [...chunks];
    const snapMap = [...speechMap];

    mediaRecorder.onstop = async () => {
        // Alustame kohe uue sessiooniga taustal
        chunks = []; speechMap = []; speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        document.getElementById('note-input').value = "";
        if (isLive) mediaRecorder.start(100);

        // --- PUHASTAMISE TUUM ---
        // Selle asemel, et lihtsalt filtreerida, loome uue massiivi
        // mis garanteerib, et meil on olemas vähemalt esimene "tükk" failist,
        // mis sisaldab vajalikku informatsiooni pleieri jaoks.
        
        let cleanBlobs = [];
        if (snapChunks.length > 0) {
            // Lisame alati faili päris esimese jupi (metadata jaoks)
            cleanBlobs.push(snapChunks[0].blob); 
            
            // Lisame kõik ülejäänud jupid, kus on kõnet (+ 2s varu)
            for (let i = 1; i < snapChunks.length; i++) {
                const chunk = snapChunks[i];
                const isSpeechNearby = snapMap.some(m => m.s && Math.abs(m.t - chunk.t) < 2000);
                if (isSpeechNearby) {
                    cleanBlobs.push(chunk.blob);
                }
            }
        }

        const fullBlob = new Blob(snapChunks.map(c => c.blob), { type: 'audio/webm' });
        const cleanBlob = cleanBlobs.length > 1 ? new Blob(cleanBlobs, { type: 'audio/webm' }) : null;

        const fullBase = await toB64(fullBlob);
        const cleanBase = cleanBlob ? await toB64(cleanBlob) : null;

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(),
            start: snapStart,
            end: snapEnd,
            hzMin: snapStats.min === Infinity ? 0 : snapStats.min, 
            hzMax: snapStats.max,
            note: snapNote,
            audioFull: fullBase, 
            audioClean: cleanBase,
            s: Math.round(snapStats.s/1000), 
            v: Math.round(snapStats.v/1000)
        });

        tx.oncomplete = () => {
            renderHistory();
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
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5">
                <div class="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                    <span>${s.start}-${s.end} | <span class="hz-accent">${s.hzMin}-${s.hzMax} Hz</span></span>
                    <button onclick="delS(${s.id})" class="text-red-900 font-bold uppercase opacity-50">Kustuta</button>
                </div>
                
                <div class="p-4 bg-green-500/5 rounded-2xl space-y-2 border border-green-500/10">
                    <div class="flex justify-between items-center text-[9px] font-black text-green-400 uppercase tracking-widest">
                        <span>Puhas vestlus (${s.s}s)</span>
                        ${s.audioClean ? `<button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')" class="text-green-400 font-bold border border-green-400/20 px-2 py-0.5 rounded">Lata .webm</button>` : ''}
                    </div>
                    ${s.audioClean ? `<audio src="${s.audioClean}" controls preload="auto"></audio>` : '<p class="text-[8px] text-slate-600 uppercase">Heli ei tuvastatud</p>'}
                </div>

                <div class="opacity-20 p-2 space-y-1">
                    <p class="text-[8px] uppercase font-bold text-slate-400">Toores puhver (+Vaikus ${s.v}s)</p>
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
