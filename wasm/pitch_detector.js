import DualRangeInput from 'https://unpkg.com/@stanko/dual-range-input@0.9.10/dist/index.js';

// Set up frequency range controls
const minFreqInput = document.getElementById('minFreq');
const maxFreqInput = document.getElementById('maxFreq');

// The third parameter is the thumb width and should be the same as "--dri-thumb-width" CSS variable
new DualRangeInput(minFreqInput, maxFreqInput, '1.25rem');

let pitchDetector = null;
let audioContext = null;
let analyser = null;
let micStream = null;

// Frequency range configuration
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 10000;
const ONSET_PERIODICITY = 0.95
const MIN_PERIODICITY = 0.9
const HYSTERESIS_DB = -60.0  // Default hysteresis in decibels
// Plot configuration
const maxDataPoints = 150;
const timeData = Array(maxDataPoints).fill(0).map((_, i) => i);
const pitchData = Array(maxDataPoints).fill(null);
const rawAudioTimeData = Array(1024).fill(0).map((_, i) => i);
const rawAudioData = Array(1024).fill(0);
const frequencyBinCount = 1024;
const frequencyData = new Float32Array(frequencyBinCount);

// Initialize plots
function initPlots() {
    console.log("Initializing plots...");
    
    // Pitch Plot
    const pitchTrace = {
        x: timeData,
        y: Array(maxDataPoints).fill(440),
        mode: 'lines+markers',
        line: {
            color: '#FF0000',
            width: 2,
        },
        marker: {
            size: 3,
            color: '#FF0000'
        },
        connectgaps: false,
        name: 'Pitch'
    };


    const pitchLayout = {
        margin: { t: 20, r: 60, l: 40, b: 20 },
        yaxis: {
            type: 'log',
            range: [Math.log10(MIN_FREQUENCY), Math.log10(MAX_FREQUENCY)],
            title: 'Frequency (Hz)',
            showgrid: false,
        },
        // yaxis2: {
        //     title: 'Note',
        //     showgrid: false,
        //     overlaying: 'y',
        //     side: 'right',
        //     tickmode: 'array',
        //     ticktext: ['C4'],
        //     tickvals: [261.63],  // C4 frequency
        //     range: [Math.log10(MIN_FREQUENCY), Math.log10(MAX_FREQUENCY)],
        //     type: 'log'
        // }
    };

    const config = {
        displayModeBar: false,
        responsive: true,
        dragmode: false,
        staticPlot: true  // This disables all interactivity
    };

    Plotly.newPlot('pitchPlot', [pitchTrace], pitchLayout, config);

    // Spectrum Plot (FFT)
    const spectrumTrace = {
        x: Array(frequencyBinCount).fill(0).map((_, i) => i * (audioContext ? audioContext.sampleRate / 2048 : 48000 / 2048)),
        y: Array(frequencyBinCount).fill(-100),
        mode: 'lines',
        line: {
            color: '#e74c3c',
            width: 1
        },
        name: 'Frequency Spectrum'
    };

    const spectrumLayout = {
        margin: { t: 20, r: 40, l: 40, b: 20 },
        yaxis: {
            title: 'Magnitude (dB)',
            range: [-100, 0],
            showgrid: false,
        },
        xaxis: {
            title: 'Frequency (Hz)',
            type: 'log',
            range: [Math.log10(MIN_FREQUENCY), Math.log10(MAX_FREQUENCY)],
            showgrid: false,
            minor: {
                showgrid: false,
                ticks: '',
                dtick: 0
            }
        },
        showlegend: false,
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
    };

    Plotly.newPlot('spectrumPlot', [spectrumTrace], spectrumLayout, config);



    function updateFrequencyRange() {
        const minFreq = parseFloat(minFreqInput.value);
        const maxFreq = parseFloat(maxFreqInput.value);
        
        if (minFreq >= maxFreq) {
            return; // Invalid range
        }

        Plotly.relayout('pitchPlot', {
            'yaxis.range': [Math.log10(minFreq), Math.log10(maxFreq)]
        });
        
        Plotly.relayout('spectrumPlot', {
            'xaxis.range': [Math.log10(minFreq), Math.log10(maxFreq)]
        });
    }

    minFreqInput.addEventListener('input', updateFrequencyRange);
    maxFreqInput.addEventListener('input', updateFrequencyRange);

    // Raw Audio Waveform Plot
    const waveformTrace = {
        x: rawAudioTimeData,
        y: rawAudioData,
        mode: 'lines',
        line: {
            color: '#2ecc71',
            width: 1
        },
        name: 'Waveform'
    };

    const waveformLayout = {
        margin: { t: 20, r: 40, l: 40, b: 20 },
        yaxis: {
            range: [-1, 1],
            showticklabels: false,
            showgrid: false
        },
        xaxis: {
            showticklabels: false,
            showgrid: false
        },
        showlegend: false,
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        title: 'Raw Audio Waveform'
    };

    Plotly.newPlot('waveformPlot', [waveformTrace], waveformLayout, config);
    console.log("All plots initialized");
}

let fftEnabled = false;

// Set up FFT toggle
document.getElementById('fftToggle').addEventListener('click', function() {
    const spectrumPlot = document.getElementById('spectrumPlot');
    fftEnabled = !fftEnabled;
    
    this.classList.toggle('active');
    this.textContent = fftEnabled ? 'Hide FFT' : 'Show FFT';
    spectrumPlot.style.display = fftEnabled ? 'block' : 'none';
});

Module.onRuntimeInitialized = function() {
    console.log('WebAssembly module loaded');
};

let lastValidPitch = null;
let lastValidPeriodicity = null;
let yTickText = ['C4'];
let yTickVals = [261.63];
// Note conversion constants
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4_FREQ = 440.0;
const A4_NOTE = 69; // MIDI note number for A4

// Piano keyboard constants
const PIANO_LOWEST_NOTE = 21; // A0 in MIDI
const PIANO_HIGHEST_NOTE = 108; // C8 in MIDI
let lastHighlightedKey = null;

initPlots();

// Initialize piano keyboard
const pianoCanvas = document.getElementById('pianoCanvas');
DrawKeyboard(pianoCanvas);

function frequencyToNote(frequency) {
    if (!frequency) return { note: '--', cents: 0, midiNote: null };
    
    // Calculate MIDI note number
    const noteNum = 12 * (Math.log2(frequency / A4_FREQ)) + A4_NOTE;
    const roundedNote = Math.round(noteNum);
    
    // Calculate cents deviation
    const cents = Math.round((noteNum - roundedNote) * 100);
    
    // Get note name and octave
    const noteName = NOTE_NAMES[roundedNote % 12];
    const octave = Math.floor(roundedNote / 12) - 1;
    
    return {
        note: `${noteName}${octave}`,
        cents: cents,
        midiNote: roundedNote
    };
}

let currentIndex = 0;
function updatePlots(frequency, rawAudioBuffer) {
    const freqDisplay = document.getElementById('frequency');
    const periodDisplay = document.getElementById('periodicity');
    const noteDisplay = document.getElementById('note');
    const centsDisplay = document.getElementById('cents');

    // console.log("Updating plots with frequency:", frequency);

    // Update last valid values if we have a new pitch
    if (frequency > 0) {
        lastValidPitch = frequency;
        lastValidPeriodicity = pitchDetector.getPeriodicity();
        freqDisplay.classList.remove('inactive');
        periodDisplay.classList.remove('inactive');
        noteDisplay.classList.remove('inactive');
        centsDisplay.classList.remove('inactive');
        // console.log("Found valid pitch:", frequency);
    } else {
        freqDisplay.classList.add('inactive');
        periodDisplay.classList.add('inactive');
        noteDisplay.classList.add('inactive');
        centsDisplay.classList.add('inactive');
        // console.log("No valid pitch detected");
    }

    // Always show the last valid values, but style differently when inactive
    if (lastValidPitch !== null && typeof lastValidPitch === 'number') {
        freqDisplay.textContent = `Frequency: ${lastValidPitch.toFixed(1)} Hz`;
        if (typeof lastValidPeriodicity === 'number') {
            periodDisplay.textContent = `Periodicity: ${lastValidPeriodicity.toFixed(3)}`;
        }
        
        // Update note display
        const noteInfo = frequencyToNote(lastValidPitch);
        noteDisplay.textContent = `Note: ${noteInfo.note}`;
        centsDisplay.textContent = `${Math.abs(noteInfo.cents)}${noteInfo.cents < 0 ? '♭' : '♯'}`;
        
        // Update piano keyboard visualization
        updatePianoKeyboard(noteInfo.midiNote);
    } else {
        freqDisplay.textContent = 'Frequency: -- Hz';
        periodDisplay.textContent = 'Periodicity: --';
        noteDisplay.textContent = 'Note: --';
        centsDisplay.textContent = 'Cents: --';
        
        // Clear piano keyboard highlight when no note is detected
        updatePianoKeyboard(null);
    }

    // Update pitch data array
    pitchData.shift();
    const newPitch = frequency > 0 ? frequency : null;
    pitchData.push(newPitch);
    
    // console.log("Current pitch data array:", pitchData.slice(-5));  // Show last 5 values
    if (frequency > 0) {
        yTickText = [frequencyToNote(frequency).note]
        yTickVals = [frequency]
        // console.log({yTickText, yTickVals})
    }
    // Get frequency spectrum data
    analyser.getFloatFrequencyData(frequencyData);
    // console.log(frequencyToNote(frequency).note)
    Plotly.update('pitchPlot', {
        y: [pitchData]
    }, {
        // 'yaxis.range': [Math.log10(MIN_FREQUENCY), Math.log10(MAX_FREQUENCY)],
        // 'yaxis2.ticktext': yTickText,
        // 'yaxis2.tickvals': yTickVals
    }, [0])
    // now print the new yaxis2 to debug it
    // console.log("yaxis2.ticktext:", document.getElementById('pitchPlot').data[0].yaxis2.ticktext);
    // // Update pitch plot with new frequency data
    // if (frequency !== null) {
    //     lastValidPitch = frequency;
        
    //     Plotly.extendTraces('pitchPlot', {
    //         y: [[frequency]]
    //     }, [0]);
        
    //     // Remove old data points if we have too many
    //     if (currentIndex >= maxDataPoints) {
    //         Plotly.relayout('pitchPlot', {
    //             xaxis: {
    //                 range: [currentIndex - maxDataPoints + 1, currentIndex]
    //             }
    //         });
    //     }
    // }

    // Only update FFT if enabled
    if (fftEnabled && rawAudioBuffer) {
        analyser.getFloatFrequencyData(frequencyData);
        const trace = {
            y: [frequencyData]
        };
        Plotly.update('spectrumPlot', trace, {}, [0]);
    }

    // Update waveform plot
    Plotly.update('waveformPlot', {
        y: [Array.from(rawAudioBuffer)]
    }, {}, [0]);
    currentIndex++;
}

async function initAudio() {
    try {
        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Add AudioWorklet module
        // await audioContext.audioWorklet.addModule('pitch_processor.js');
        
        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream = stream;
        
        // Create nodes for the audio graph
        const source = audioContext.createMediaStreamSource(stream);
        // const processor = new AudioWorkletNode(audioContext, 'pitch-processor', {
        //     processorOptions: {
        //         minFrequency: MIN_FREQUENCY,
        //         maxFrequency: MAX_FREQUENCY,
        //         sampleRate: audioContext.sampleRate
        //     }
        // });
        const processor = audioContext.createScriptProcessor(1024, 1, 1);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048/8; // This gives us 1024 frequency bins
        analyser.smoothingTimeConstant = 0.8; // Smooth out the spectrum visualization
        
        // Initialize pitch detector
        pitchDetector = new Module.PitchDetector(
            MIN_FREQUENCY,
            MAX_FREQUENCY,
            audioContext.sampleRate,
            // HYSTERESIS_DB,      // hysteresis_db
            ONSET_PERIODICITY,  // onset_periodicity
            MIN_PERIODICITY     // min_periodicity
        );
        
        // Connect the audio graph
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioContext.destination);
        let lastFrequency = 0;
        // Process audio
        processor.onaudioprocess = function(e) {
            const input = e.inputBuffer.getChannelData(0);
            let frequency = 0;
            
            // Get raw audio data for waveform
            const rawAudioData = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(rawAudioData);
            
            let wasUpdated = false;
            // Process each sample for pitch detection
            let frequencyDetected = false;
            for (let i = 0; i < input.length; i++) {
                if (pitchDetector.process(input[i])) {
                    wasUpdated = true;

                    // console.log("Pitch detected at i =", i);
                    const thisFreq = pitchDetector.getFrequency();
                    const thisPeriodicity = pitchDetector.getPeriodicity();
                    // console.log("thisPeriodicity:", thisPeriodicity);
                    lastFrequency = thisFreq;
                    if (thisFreq !== 0) {
                        frequency = thisFreq
                        // console.log("Frequency:", frequency);
                        frequencyDetected = true;
                    }
                }
            }
            if (!frequencyDetected) {
                frequency = 0;
            }

            // console.log(`${pitchDetector.getFrequency().toFixed(2)} ${pitchDetector.getPeriodicity().toFixed(2)}`);
            // console.log("Final frequency:", frequency);
            // console.log("Samples:", input.length);
            // updatePlots(frequency, rawAudioData);
            updatePlots(pitchDetector.getFrequency(), rawAudioData);
        };
        // // Listen for pitch messages from the worklet
        // processor.port.onmessage = (event) => {
        //     const { frequency, rawAudioBuffer } = event.data;
        //     updatePlots(frequency, rawAudioBuffer);
        // };
        
    } catch (error) {
        console.error('Error setting up audio:', error);
    }
}

// Set up button handler
document.getElementById('startButton').onclick = async () => {
    const thisEl = document.getElementById('startButton')
    if (audioContext === null) {
        // initPlots();

        await initAudio();
        thisEl.textContent = 'Stop';
    } else {
        // Clean up
        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
        }
        await audioContext.close();
        audioContext = null;
        thisEl.textContent = 'Start Microphone';
    }
};

// Frequency conversion functions
function logToHz(value) {
    return Math.round(Math.pow(10, value));
}

function hzToLog(hz) {
    return Math.log10(hz);
}

// Set up frequency range value display with logarithmic conversion
document.getElementById('minFreq').addEventListener('input', function() {
    const hzValue = logToHz(this.value);
    document.getElementById('minFreqValue').textContent = hzValue;
});

document.getElementById('maxFreq').addEventListener('input', function() {
    const hzValue = logToHz(this.value);
    document.getElementById('maxFreqValue').textContent = hzValue;
});

// Initialize the frequency values
document.getElementById('minFreqValue').textContent = logToHz(document.getElementById('minFreq').value);
document.getElementById('maxFreqValue').textContent = logToHz(document.getElementById('maxFreq').value);

// Function to update the piano keyboard visualization
function updatePianoKeyboard(midiNote) {
    console.log("updatePianoKeyboard() called with midiNote:", midiNote);
    // Convert MIDI note to piano key index (0-87, where 0 is A0 and 87 is C8)
    let pianoKeyIndex = null;
    
    if (midiNote !== null) {
        // Only highlight notes within the piano range
        if (midiNote >= PIANO_LOWEST_NOTE && midiNote <= PIANO_HIGHEST_NOTE) {
            pianoKeyIndex = midiNote - PIANO_LOWEST_NOTE;
        }
    }
    
    // Only redraw if the highlighted key has changed
    if (pianoKeyIndex !== lastHighlightedKey) {
        lastHighlightedKey = pianoKeyIndex;
        
        // Clear previous highlighting and draw new one
        const redKeys = pianoKeyIndex !== null ? [pianoKeyIndex] : [];
        console.log("Red keys:", redKeys);
        DrawKeyboard(pianoCanvas, redKeys);
    }
}

console.log("new")