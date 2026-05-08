"use client";

import * as Tone from "tone";

const SALAMANDER_BASE = "https://tonejs.github.io/audio/salamander/";

const PIANO_SAMPLE_MAP: Record<string, string> = {
  A0: "A0.mp3",
  C1: "C1.mp3",
  "D#1": "Ds1.mp3",
  "F#1": "Fs1.mp3",
  A1: "A1.mp3",
  C2: "C2.mp3",
  "D#2": "Ds2.mp3",
  "F#2": "Fs2.mp3",
  A2: "A2.mp3",
  C3: "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  A3: "A3.mp3",
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
  A5: "A5.mp3",
  C6: "C6.mp3",
  "D#6": "Ds6.mp3",
  "F#6": "Fs6.mp3",
  A6: "A6.mp3",
};

class AudioEngine {
  private piano: Tone.Sampler | null = null;
  private droneSynth: Tone.PolySynth | null = null;
  private droneFilter: Tone.Filter | null = null;
  private droneActive = false;
  private droneNotes: string[] = [];
  private analyser: Tone.Analyser | null = null;
  private chordVolume: Tone.Volume | null = null;
  private melodyVolume: Tone.Volume | null = null;
  private droneVolume: Tone.Volume | null = null;
  private chordReverb: Tone.Reverb | null = null;
  private ready = false;
  private loadingPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      await Tone.start();

      this.analyser = new Tone.Analyser("fft", 64);

      this.chordVolume = new Tone.Volume(-6).toDestination();
      this.chordVolume.connect(this.analyser);
      this.chordReverb = new Tone.Reverb({ decay: 4, wet: 0.35 }).connect(this.chordVolume);

      this.melodyVolume = new Tone.Volume(-2).toDestination();
      this.melodyVolume.connect(this.analyser);

      this.droneVolume = new Tone.Volume(-18).toDestination();
      this.droneVolume.connect(this.analyser);

      this.piano = new Tone.Sampler({
        urls: PIANO_SAMPLE_MAP,
        baseUrl: SALAMANDER_BASE,
        release: 1.4,
        onload: () => {
          this.ready = true;
        },
      });

      this.droneFilter = new Tone.Filter(700, "lowpass").connect(this.droneVolume);
      this.droneSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 2, decay: 0, sustain: 1, release: 3 },
      }).connect(this.droneFilter);

      await Tone.loaded();
      this.piano.connect(this.chordReverb);
      this.piano.connect(this.melodyVolume);
      this.ready = true;
    })();

    return this.loadingPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  playChord(notes: string[], duration = "2n", velocity = 0.7): void {
    if (!this.ready || !this.piano) return;
    this.piano.triggerAttackRelease(notes, duration, undefined, velocity);
  }

  playNote(note: string, duration = "8n", velocity = 0.8): void {
    if (!this.ready || !this.piano) return;
    this.piano.triggerAttackRelease(note, duration, undefined, velocity);
  }

  startDrone(rootNote: string): void {
    if (!this.droneSynth) return;
    const tonic = rootNote.replace(/\d+$/, "");
    const newNotes = [`${tonic}2`, `${tonic}3`];
    if (this.droneActive && newNotes.join(",") === this.droneNotes.join(",")) return;
    if (this.droneActive) {
      this.droneSynth.triggerRelease(this.droneNotes);
    }
    this.droneSynth.triggerAttack(newNotes);
    this.droneNotes = newNotes;
    this.droneActive = true;
  }

  stopDrone(): void {
    if (!this.droneSynth || !this.droneActive) return;
    this.droneSynth.triggerRelease(this.droneNotes);
    this.droneActive = false;
    this.droneNotes = [];
  }

  getAnalyserValues(): Float32Array | null {
    if (!this.analyser) return null;
    const v = this.analyser.getValue();
    return v instanceof Float32Array ? v : null;
  }
}

let engineSingleton: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineSingleton) engineSingleton = new AudioEngine();
  return engineSingleton;
}
