const AUTO_FIX_MS = 10 * 60 * 1000; 
let isLive = false, speechMs = 0, silenceMs = 0, db, stream, mediaRecorder, wakeLock = null;
let chunks = [], speechMap = [], pitchHistory = [];
let sessionStartTime = "", autoFixInterval;

setInterval(() => { 
    document.getElementById('clock').innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

const dbReq = indexedDB.open("Peegel_Pro_V21", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

async function startEngine() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
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

            document.getElementById('volume-bar').style.width = Math.min(vol * 6, 100) + "%";
            document.getElementById('hz-display').innerText = hz + " Hz";

            const t = Date.now();
            if (vol > 3 && hz > 50) {
                speechMs += 50; pitchHistory.push(hz);
                document.getElementById('status-light').style.background = "#22c55e";
                speechMap.push({ t: t, s: true });
            } else {
                silenceMs += 50;
                document.getElementById('status-light').style.background = "#334155";
                speechMap.push({ t: t, s: false });
            }
            document.getElementById('speech-time').innerText = (speechMs / 60000).toFixed(1) + " min";
            document.getElementById('silence-time').innerText = (silenceMs / 60000).toFixed(1) + " min";
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
    const currentPitch = [...pitchHistory];
    const currentSpeechMs = speechMs;
    const currentSilenceMs = silenceMs;

    mediaRecorder.onstop = async () => {
        const avgHz = currentPitch.length > 0 ? Math.round(currentPitch.reduce((a,b)=>a+b)/currentPitch.length) : 0;
        
        // Filtreerimine: salvestame ainult vestluse osad
        const cleanChunks = currentChunks.filter(chunk => {
            const mapPoint = currentMap.find(m => Math.abs(m.t - chunk.t) < 150);
            return mapPoint ? mapPoint.s : false;
        }).map(c => c.blob);

        const fullBlob = new Blob(currentChunks.map(c => c.blob), { type: 'audio/webm' });
        const cleanBlob = new Blob(cleanChunks, { type: 'audio/webm' });

        const fullBase64 = await blobToBase64(fullBlob);
        const cleanBase64 = await blobToBase64(cleanBlob);

        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").add({
            id: Date.now(),
            start: sessionStartTime,
            end: endTime,
            hz: avgHz,
            note: note,
            audioFull: fullBase64,
            audioClean: cleanBase64,
            speechTotal: (currentSpeechMs / 60000).toFixed(1),
            silenceTotal: (currentSilenceMs / 60000).toFixed(1)
        });

        tx.oncomplete = () => {
            renderHistory();
            chunks = []; speechMap = []; speechMs = 0; silenceMs = 0; pitchHistory = [];
            document.getElementById('note-input').value = "";
            sessionStartTime = new Date().toLocaleTimeString('et-EE');
            if (isLive) mediaRecorder.start(100);
            if (callback) callback();
        };
    };
    mediaRecorder.stop();
}

function blobToBase64(blob) {
    return new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(blob); });
}

function renderHistory() {
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 border border-white/5 space-y-4 shadow-xl">
                <div class="flex justify-between items-start">
                    <div class="text-[10px] font-bold text-slate-500 uppercase leading-tight">
                        ${s.start} — ${s.end}<br>
                        <span class="text-green-500">Heli: ${s.speechTotal}m</span> | <span class="text-slate-600">Vaikus: ${s.silenceTotal}m</span> | ${s.hz}Hz
                    </div>
                    <button onclick="delS(${s.id})" class="text-red-900 font-bold text-[10px] uppercase">Kustuta</button>
                </div>

                <div class="bg-black/20 p-3 rounded-2xl space-y-2">
                    <div class="flex justify-between items-center">
                         <p class="text-[9px] uppercase font-black text-blue-400">Töödeldud vestlus:</p>
                         <button onclick="dl('${s.audioClean}', 'Puhas_${s.id}')" class="text-blue-400 text-[9px] font-bold uppercase">Lata .webm</button>
                    </div>
                    <audio src="${s.audioClean}" controls class="h-8 w-full"></audio>
                </div>

                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full bg-white/5 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest text-slate-500">Kuva Märge</button>
                <div class="hidden p-4 bg-black/40 rounded-2xl text-xs italic text-slate-300 border-l-2 border-blue-600">
                    ${s.note || 'Märkmeid ei ole.'}
                </div>
            </div>
        `).join('');
    };
}

window.dl = (data, name) => { const a = document.createElement('a'); a.href = data; a.download = `${name}.webm`; a.click(); };
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
        if(wakeLock) wakeLock.release();
        fixSession(() => location.reload());
    }
};
