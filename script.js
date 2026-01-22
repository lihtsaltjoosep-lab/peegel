// KONTROLL: Kas skript üldse laeb?
console.log("Peegel v43 laeb...");

// Globaalsed muutujad
let isLive = false;
let speechMs = 0;
let silenceMs = 0;
let db = null;
let stream = null;
let audioCtx = null;
let speechBuffer = [];
let rawChunks = [];
let sessionStartTime = "";

// 1. KELL (Käivitub kohe)
const clockTimer = setInterval(() => {
    const c = document.getElementById('clock');
    if (c) c.innerText = new Date().toLocaleTimeString('et-EE');
}, 1000);

// 2. ANDMEBAAS (Uus nimi konfliktide vältimiseks)
const dbReq = indexedDB.open("Peegel_V43_Debug", 1);
dbReq.onupgradeneeded = (e) => {
    e.target.result.createObjectStore("sessions", { keyPath: "id" });
    console.log("Andmebaas loodud");
};
dbReq.onsuccess = (e) => {
    db = e.target.result;
    console.log("Andmebaas ühendatud");
    renderHistory();
};
dbReq.onerror = () => alert("Andmebaasi viga! Proovi Incognito akent.");

// 3. START NUPU FUNKTSIOON
async function startSession() {
    console.log("Start funktsioon käivitus");
    
    try {
        // Küsime mikrofoni
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Mikrofon lubatud");

        // Vahetame ekraani
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');

        // Helimootor
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);

        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioCtx.destination);

        processor.onaudioprocess = (e) => {
            if (!isLive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            
            const vol = data.reduce((a, b) => a + b) / data.length;
            
            // Lihtsustatud hääle tuvastus (lävi 2.5)
            if (vol > 2.5) {
                speechMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#22c55e";
                speechBuffer.push(new Float32Array(inputData));
            } else {
                silenceMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#334155";
            }
            
            document.getElementById('speech-sec').innerText = Math.round(speechMs / 1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs / 1000) + "s";
        };

        // Toores salvesti
        const rawRecorder = new MediaRecorder(stream);
        rawRecorder.ondataavailable = e => { if (e.data.size > 0) rawChunks.push(e.data); };
        window.currentRawRecorder = rawRecorder; // Salvestame globaalselt
        rawRecorder.start();

        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        console.log("Sessioon aktiivne");

    } catch (err) {
        console.error("START VIGA:", err);
        alert("VIGA: " + err.message);
    }
}

// SEOUME NUPUGA (kõige lollikindlam meetod)
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('start-btn');
    if (btn) {
        btn.onclick = startSession;
        console.log("Start nupp seotud");
    } else {
        console.error("Start nuppu ei leitud DOM-ist!");
    }
});

// 4. FIKSEERI
async function fixSession() {
    if (!isLive) return;
    console.log("Fikseerin...");

    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime;
    const snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { s: speechMs, v: silenceMs };
    const currentSpeech = [...speechBuffer];
    const currentRaw = [...rawChunks];
    const currentSR = audioCtx.sampleRate;

    // Nullime kohe
    speechBuffer = []; rawChunks = [];
    speechMs = 0; silenceMs = 0;
    document.getElementById('note-input').value = "";
    sessionStartTime = new Date().toLocaleTimeString('et-EE');

    // WAV genereerimine
    const cleanWav = bufferToWav(currentSpeech, currentSR);
    const fullBlob = new Blob(currentRaw, { type: 'audio/webm' });

    const cleanBase = await toB64(cleanWav);
    const fullBase = await toB64(fullBlob);

    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").add({
        id: Date.now(), start: snapStart, end: snapEnd,
        note: snapNote, audioFull: fullBase, audioClean: cleanBase,
        s: Math.round(snapStats.s / 1000), v: Math.round(snapStats.v / 1000)
    });

    tx.oncomplete = () => {
        console.log("Salvestatud!");
        renderHistory();
        if (window.currentRawRecorder && window.currentRawRecorder.state !== "inactive") {
            window.currentRawRecorder.stop();
            window.currentRawRecorder.start();
        }
    };
}

// ABI: WAV
function bufferToWav(chunks, sampleRate) {
    const length = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
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

// LOGI
function renderHistory() {
    if (!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = (e) => {
        const list = e.target.result.sort((a, b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y-4 shadow-xl border border-white/5 text-left">
                <div class="flex justify-between text-[10px] font-bold uppercase">
                    <span class="text-fix-orange">${s.start}-${s.end} | V: <span class="text-silence-red">${s.v}s</span></span>
                    <button onclick="delS(${s.id})" class="btn-delete-dark">KUSTUTA</button>
                </div>
                <div class="p-4 bg-green-500/5 rounded-2xl space-y-2 border border-green-500/10">
                    <p class="text-[9px] font-black text-green-400 uppercase">Puhas vestlus (${s.s}s)</p>
                    <audio src="${s.audioClean}" controls></audio>
                </div>
                <button onclick="this.nextElementSibling.classList.toggle('hidden')" class="w-full py-2 text-[10px] font-bold uppercase text-fix-orange bg-yellow-500/10 rounded-xl">Märge</button>
                <div class="hidden p-3 bg-black/40 rounded-xl text-xs text-slate-300">${s.note || '...'}</div>
            </div>`).join('');
    };
}

window.delS = (id) => { if (confirm("Kustuta?")) { db.transaction("sessions", "readwrite").objectStore("sessions").delete(id).onsuccess = renderHistory; } };
document.getElementById('manual-fix').onclick = fixSession;
document.getElementById('stop-session').onclick = () => { if (confirm("Lõpeta?")) location.reload(); };
