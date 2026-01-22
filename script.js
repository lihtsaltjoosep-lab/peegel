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
    const s = totalSeconds % 60;<!DOCTYPE html>
<html lang="et">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Peegel Pro v71</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #020617; color: #e2e8f0; font-family: sans-serif; -webkit-tap-highlight-color: transparent; }
        .glass { background: rgba(30, 41, 59, 0.4); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.05); }
        .hidden { display: none !important; }
        audio { height: 35px; width: 100%; border-radius: 12px; filter: invert(1) brightness(0.7) contrast(1.3) sepia(1) hue-rotate(195deg) saturate(6); }
        #clock { color: #f59e0b; font-weight: 300; }
    </style>
</head>
<body class="p-4 min-h-screen flex flex-col items-center">
    <div class="w-full max-w-md space-y-4">
        <div class="flex justify-between items-center p-2">
            <h1 class="text-xl font-black text-blue-500 italic uppercase">Peegel</h1>
            <div id="clock" class="text-3xl font-light tracking-tighter">00:00:00</div>
        </div>

        <div id="setup-screen" class="pt-20 flex flex-col items-center">
            <button onclick="startSession()" class="bg-blue-600 w-36 h-36 rounded-full font-black text-2xl text-white shadow-2xl border-4 border-blue-400 active:scale-90">START</button>
            <p class="mt-4 text-slate-500 text-xs uppercase tracking-widest">v71: Hz Ees ja Hele</p>
        </div>

        <div id="active-session" class="hidden space-y-4">
            <div class="glass rounded-[35px] p-6 shadow-2xl space-y-4 border-t border-blue-500/20">
                <div class="flex justify-between items-center pb-3 border-b border-white/5">
                    <div class="flex items-center gap-4">
                        <div id="status-light" class="w-4 h-4 bg-slate-700 rounded-full transition-all"></div>
                        <div class="flex gap-4 font-mono text-[14px] uppercase font-bold">
                            <span class="text-green-400">V:<span id="speech-sec">0m 0s</span></span>
                            <span style="color: #60a5fa;">P:<span id="silence-sec">0m 0s</span></span>
                        </div>
                    </div>
                    
                    <div class="flex gap-2 font-mono text-[12px] uppercase font-bold items-center">
                        <span class="text-cyan-300">Hz</span>

                        <span style="color: #1d4ed8;" id="hz-min-val">0</span>
                        
                        <span class="text-red-500" id="hz-max-val">0</span>
                    </div>
                </div>
                <textarea id="note-input" class="w-full bg-transparent text-sm text-slate-200 focus:outline-none placeholder-slate-700 resize-none font-medium h-32 pt-2" placeholder="Kirjuta märkmed siia..." rows="5"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <button onclick="fixSession()" class="bg-blue-600 text-white py-5 rounded-[25px] font-black uppercase text-xs tracking-widest active:scale-95 shadow-lg">Fikseeri</button>
                <button id="stop-btn" onclick="stopAndSave()" class="bg-red-900/40 text-red-500 py-5 rounded-[25px] font-black uppercase text-xs active:scale-95">Lõpeta</button>
            </div>
        </div>

        <div class="w-full space-y-4 pt-4 pb-24 text-center">
            <h3 class="text-[10px] font-black uppercase tracking-[0.4em] text-slate-700 italic">Sessioonide logi</h3>
            <div id="history-container" class="space-y-4 mt-4 text-left"></div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>
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
            
            if (hz > 40 && hz < 2
