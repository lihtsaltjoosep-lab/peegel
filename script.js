// Logimise abimees
function log(msg) {
    const d = document.getElementById('debug-log');
    d.innerHTML += `<br>> ${msg}`;
    d.scrollTop = d.scrollHeight;
}

let db, stream, audioCtx, analyser, processor, isLive = false;
let speechMs = 0, silenceMs = 0, chunks = [], speechBuffer = [];

// KELL
setInterval(() => {
    document.getElementById('clock').innerText = new Date().toLocaleTimeString('et-EE');
}, 1000);

// ANDMEBAAS
const request = indexedDB.open("Peegel_V44", 1);
request.onupgradeneeded = e => e.target.result.createObjectStore("sessions", { keyPath: "id" });
request.onsuccess = e => { db = e.target.result; renderHistory(); log("Andmebaas OK."); };

// START
async function startSession() {
    log("Käivitan mikrofoni...");
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        processor = audioCtx.createScriptProcessor(4096, 1, 1);

        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioCtx.destination);

        processor.onaudioprocess = (e) => {
            if (!isLive) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            const vol = data.reduce((a, b) => a + b) / data.length;

            if (vol > 2.5) {
                speechMs += 93; // 4096 samples @ 44.1kHz
                speechBuffer.push(new Float32Array(inputData));
                document.getElementById('status-light').style.background = "#22c55e";
            } else {
                silenceMs += 93;
                document.getElementById('status-light').style.background = "#334155";
            }
            document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
            document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
        };

        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        isLive = true;
        log("Sessioon aktiivne!");
    } catch (err) {
        log("VIGA: " + err.message);
        alert("Mikkrit ei saa kasutada: " + err.message);
    }
}

// FIKSEERI
async function fixSession() {
    if (!isLive) return;
    log("Salvestan...");
    
    const note = document.getElementById('note-input').value;
    const time = new Date().toLocaleTimeString('et-EE');
    const stats = { s: Math.round(speechMs/1000), v: Math.round(silenceMs/1000) };
    
    const wavBlob = bufferToWav(speechBuffer, audioCtx.sampleRate);
    const base64 = await new Promise(r => {
        const reader = new FileReader();
        reader.onloadend = () => r(reader.result);
        reader.readAsDataURL(wavBlob);
    });

    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").add({
        id: Date.now(),
        time: time,
        note: note,
        audio: base64,
        s: stats.s,
        v: stats.v
    });

    tx.oncomplete = () => {
        speechBuffer = []; speechMs = 0; silenceMs = 0;
        document.getElementById('note-input').value = "";
        renderHistory();
        log("Salvestatud.");
    };
}

// ABI: WAV (Lihtsustatud)
function bufferToWav(chunks, sampleRate) {
    const len = chunks.reduce((acc, c) => acc + c.length, 0);
    const buf = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 32 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data');
    view.setUint32(40, len * 2, true);
    let o = 44;
    for (let c of chunks) {
        for (let i = 0; i < c.length; i++) {
            let s = Math.max(-1, Math.min(1, c[i]));
            view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            o += 2;
        }
    }
    return new Blob([buf], { type: 'audio/wav' });
}

// LOGI
function renderHistory() {
    if (!db) return;
    db.transaction("sessions", "readonly").objectStore("sessions").getAll().onsuccess = (e) => {
        const list = e.target.result.sort((a, b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass p-4 rounded-2xl space-y-2">
                <div class="flex justify-between text-[10px] font-bold">
                    <span class="text-fix-orange">${s.time}</span>
                    <span class="text-red-500">V: ${s.v}s</span>
                </div>
                <audio src="${s.audio}" controls></audio>
                <p class="text-[10px] text-slate-400 italic">${s.note || ''}</p>
            </div>`).join('');
    };
}
