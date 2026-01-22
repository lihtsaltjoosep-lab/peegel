<!DOCTYPE html>
<html lang="et">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Peegel Pro v57</title>
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
        </div>

        <div id="active-session" class="hidden space-y-4">
            <div class="glass rounded-[35px] p-6 shadow-2xl space-y-4 border-t border-blue-500/20">
                <div class="flex justify-between items-center pb-3 border-b border-white/5">
                    <div class="flex items-center gap-4">
                        <div id="status-light" class="w-4 h-4 bg-slate-700 rounded-full transition-all"></div>
                        <div class="flex gap-4 font-mono text-[14px] uppercase font-bold">
                            <span class="text-green-400">V:<span id="speech-sec">0m 0s</span></span>
                            <span class="text-blue-400">P:<span id="silence-sec">0m 0s</span></span>
                        </div>
                    </div>
                    <div class="flex gap-2 font-mono text-[12px] uppercase font-bold">
                        <span class="text-cyan-300">Hz <span id="hz-min-val" class="text-blue-500">0</span></span>
                        <span class="text-red-500"><span id="hz-max-val">0</span></span>
                    </div>
                </div>
                <textarea id="note-input" class="w-full bg-transparent text-sm text-slate-200 focus:outline-none placeholder-slate-800 resize-none font-medium h-32 pt-2" placeholder="Kirjuta märkmed siia..." rows="5"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <button id="fix-btn" onclick="fixSession()" class="bg-blue-600 text-white py-5 rounded-[25px] font-black uppercase text-xs tracking-widest active:scale-95 shadow-lg">Fikseeri</button>
                <button id="stop-btn" onclick="stopAndSave()" class="bg-red-900/40 text-red-500 py-5 rounded-[25px] font-black uppercase text-xs active:scale-95">Lõpeta</button>
            </div>
        </div>

        <div class="w-full space-y-4 pt-4 pb-24 text-center">
            <h3 class="text-[10px] font-black uppercase tracking-[0.4em] text-slate-700 italic">Sessioonide logi</h3>
            <div id="history-container" class="space-y-4 mt-4"></div>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>
