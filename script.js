const VOLUME_THRESHOLD = 6.0; 
const MIN_HZ = 80;            
const AUTO_FIX_MS = 600000; 
const MIN_SPEECH_TO_SAVE_MS = 2000; 

let isLive = false, speechMs = 0, silenceMs = 0, db, stream = null;
let audioCtx = null, processor = null, source = null, speechBuffer = [];
let hzMin = Infinity, hzMax = 0, sessionStartTime = "";
let autoFixTimer = null;

function formatTime(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m ${s}s`;
}

setInterval(() => { 
    const c = document.getElementById('clock');
    if(c) c.innerText = new Date().toLocaleTimeString('et-EE'); 
}, 1000);

const dbReq = indexedDB.open("Peegel_DataCapsule_V61", 1);
dbReq.onupgradeneeded = e => { e.target.result.createObjectStore("sessions", { keyPath: "id" }); };
dbReq.onsuccess = e => { db = e.target.result; renderHistory(); };

async function startSession() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        source = audioCtx.createMediaStreamSource(stream);
        const filter = audioCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 100; 
        const analyser = audioCtx.createAnalyser();
        processor = audioCtx.createScriptProcessor(4096, 1, 1);
        source.connect(filter);
        filter.connect(analyser);
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
            
            if (vol > VOLUME_THRESHOLD && hz > MIN_HZ) {
                speechMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#22c55e";
                speechBuffer.push(new Float32Array(inputData));
            } else {
                silenceMs += (4096 / audioCtx.sampleRate) * 1000;
                document.getElementById('status-light').style.background = "#334155";
            }
            document.getElementById('speech-sec').innerText = formatTime(speechMs);
            document.getElementById('silence-sec').innerText = formatTime(silenceMs);
        };
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('active-session').classList.remove('hidden');
        sessionStartTime = new Date().toLocaleTimeString('et-EE');
        isLive = true;
        autoFixTimer = setInterval(fixSession, AUTO_FIX_MS);
    } catch (err) { alert("Mikrofoni viga!"); }
}

async function stopAndSave() {
    if (!isLive) return;
    document.getElementById('stop-btn').innerText = "KONTROLLIN...";
    isLive = false;
    clearInterval(autoFixTimer);
    await fixSession(true); 
    if (stream) stream.getTracks().forEach(t => t.stop());
    location.reload();
}

function fixSession(isFinal = false) {
    return new Promise((resolve) => {
        if (speechMs < MIN_SPEECH_TO_SAVE_MS) {
            if (isFinal) {
                alert("Sessioon oli liiga lühike (alla 2s) või tühi.\nEi salvestanud.");
            }
            speechBuffer = [];
            speechMs = 0;
            silenceMs = 0;
            hzMin = Infinity; 
            hzMax = 0;
            document.getElementById('note-input').value = ""; 
            return resolve();
        }

        const snapNote = document.getElementById('note-input').value;
        const snapStart = sessionStartTime, snapEnd = new Date().toLocaleTimeString('et-EE');
        const snapStats = { min: hzMin, max: hzMax, s
