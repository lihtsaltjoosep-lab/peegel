let isLive = false, speechMs = 0, silenceMs = 0, db, stream = null, wakeLock = null;
let rawRecorder = null, audioCtx = null, processor = null, source = null, speechBuffer = [];
let rawChunks = [], hzMin = Infinity, hzMax = 0, sessionStartTime = "";

// 1. KELL (Oranž)
setInterval(() => { 
    const clock = document.getElementById('clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

// 2. ANDMEBAAS (Uus nimi V41, et vältida vanu vigu)
const dbReq = indexedDB.open("Peegel_Pro_V41", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

// 3. START (Nüüd lollikindel)
document.getElementById('start-btn').onclick = async () => {
    try {
        if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            processor = audioCtx.createScriptProcessor(4096, 1, 1);

            source.connect(analyser);
            analyser.connect(processor);
            processor.connect(audioCtx.destination);

            processor.onaudioprocess = (e) => {
                if (!isLive) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const data = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(data);
                
                const vol = data.reduce((a,b) => a+b) / data.length;
                let maxVal = -1, maxIdx = -1;
                for (let i = 0; i < data.length/2; i++) { if (data[i] > maxVal) { maxVal = data[i]; maxIdx = i; } }
                const hz = Math.round(maxIdx * (audioCtx.sampleRate/2) / (data.length/2));
                
                if (hz > 40 && hz < 2000) {
                    if (hz < hzMin) hzMin = hz; if (hz > hzMax) hzMax = hz;
                    document.getElementById('hz-min-val').innerText = hzMin;
                    document.getElementById('hz-max-val').innerText = hzMax;
                }

                const isSpeaking = vol > 2.5 && hz > 50;
                if (isSpeaking) {
                    speechMs += (4096 / audioCtx.sampleRate) * 1000;
                    document.getElementById('status-light').style.background = "#22c55e";
                    speechBuffer.push(new Float32Array(inputData));
                } else {
                    silenceMs += (4096 / audioCtx.sampleRate) * 1000;
                    document.getElementById('status-light').style.background = "#334155";
                }
                
                document.getElementById('speech-sec').innerText = Math.round(speechMs/1000) + "s";
                document.getElementById('silence-sec').innerText = Math.round(silenceMs/1000) + "s";
            };
        }

        if (!rawRecorder || rawRecorder.state === "inactive") {
            rawRecorder = new MediaRecorder(stream);
            rawRecorder.ondataavailable = e => { if (e.data.size > 0) rawChunks.push(e.data); };
            rawRecorder.start();
        }

        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
    } catch (err) { 
        alert("Mikrofoni luba puudub või viga: " + err); 
    }
};

// 4. FIKSEERI (Võimaldab mitu sessiooni järjest)
async function fixSession() {
    if (!isLive) return;
    
    // Pildistame hetke andmed
    const snapNote = document.getElementById('note-input').value;
    const snapStart = sessionStartTime;
    const snapEnd = new Date().toLocaleTimeString('et-EE');
    const snapStats = { min: hzMin, max: hzMax, s: speechMs, v: silenceMs };
    const currentSpeechBuffer = [...speechBuffer];
    const currentRawChunks = [...rawChunks];
    const currentSR = audioCtx.sampleRate;

    // NULLIME NÄIDIKUD KOHE
    speechBuffer = []; rawChunks = [];
    speechMs = 0; silenceMs = 0; hzMin = Infinity; hzMax = 0;
    document.getElementById('note-input').value = "";
    sessionStartTime = new Date().toLocaleTimeString('et-EE');

    // Andmebaasi salvestamine taustal
    const fullBlob = new Blob(currentRawChunks, { type: 'audio/webm' });
    const cleanWavBlob = bufferToWav(currentSpeechBuffer, currentSR);

    const fullBase = await toB64(fullBlob);
    const cleanBase = await toB64(cleanWavBlob);

    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").add({
        id: Date.now(), start: snapStart, end: snapEnd,
        hzMin: snapStats.min, hzMax: snapStats.max,
        note: snapNote, audioFull: fullBase, audioClean: cleanBase,
        s: Math.round(snapStats.s/1000), v: Math.round(snapStats.v/1000)
    });

    tx.oncomplete = () => renderHistory();
    
    // Restartime toore faili lindistaja, et failid ei kattuks
    if (rawRecorder && rawRecorder.state !== "inactive") {
        rawRecorder.stop();
        rawRecorder.start();
    }
}

function bufferToWav(chunks, sampleRate) {
    const length = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
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

function renderHistory() {
    if(!db) return;
    const tx = db.transaction("sessions", "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const list = e.target.result.sort((a,b) => b.id - a.id);
        document.getElementById('history-container').innerHTML = list.map(s => `
            <div class="glass rounded-[30px] p-5 space-y
