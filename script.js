if (Speech) {
            recognition = new Speech(); 
            recognition.continuous = true; 
            recognition.interimResults = true; // See lubab näha teksti rääkimise ajal!
            recognition.lang = 'et-EE';
            
            recognition.onresult = e => {
                let interimTranscript = "";
                let finalTranscript = "";
                
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    if (e.results[i].isFinal) {
                        finalTranscript += e.results[i][0].transcript;
                    } else {
                        interimTranscript += e.results[i][0].transcript;
                    }
                }
                // Näitame kohe nii lõplikku kui ka poolikut teksti
                document.getElementById('live-transcript').innerText = (finalTranscript + interimTranscript) || "...";
            };
            
            recognition.onerror = e => console.error("Speech viga:", e.error);
            recognition.onend = () => { if (isLive) recognition.start(); };
            recognition.start();
        }if (Speech) {
            recognition = new Speech(); 
            recognition.continuous = true; 
            recognition.interimResults = true; // See lubab näha teksti rääkimise ajal!
            recognition.lang = 'et-EE';
            
            recognition.onresult = e => {
                let interimTranscript = "";
                let finalTranscript = "";
                
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    if (e.results[i].isFinal) {
                        finalTranscript += e.results[i][0].transcript;
                    } else {
                        interimTranscript += e.results[i][0].transcript;
                    }
                }
                // Näitame kohe nii lõplikku kui ka poolikut teksti
                document.getElementById('live-transcript').innerText = (finalTranscript + interimTranscript) || "...";
            };
            
            recognition.onerror = e => console.error("Speech viga:", e.error);
            recognition.onend = () => { if (isLive) recognition.start(); };
            recognition.start();
        }
