"use client";

import * as Tone from "tone";
import { Instrument, Pattern, notesForStep } from "./theory";

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

const GUITAR_POLYPHONY = 6;

class AudioEngine {
  private piano: Tone.Sampler | null = null;
  // Manual pool of PluckSynth voices — Tone.PluckSynth isn't Monophonic-typed,
  // so Tone.PolySynth(Tone.PluckSynth) won't compile. Round-robin assignment.
  private guitarPool: Tone.PluckSynth[] = [];
  private guitarPoolIdx = 0;
  private guitarVolume: Tone.Volume | null = null;
  private instrument: Instrument = "piano";
  private droneSynth: Tone.PolySynth | null = null;
  private droneFilter: Tone.Filter | null = null;
  private droneActive = false;
  private droneNotes: string[] = [];

  private analyser: Tone.Analyser | null = null;
  private chordVolume: Tone.Volume | null = null;
  private droneVolume: Tone.Volume | null = null;
  private chordReverb: Tone.Reverb | null = null;

  private loop: Tone.Loop | null = null;
  private currentChord: string[] = [];
  private currentPattern: Pattern | null = null;
  private stepCounter = 0;
  private loopRunning = false;
  private chordChangedAt = -1; // step index when chord last changed

  private ready = false;
  private loadingPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      await Tone.start();
      Tone.Transport.bpm.value = 110;

      this.analyser = new Tone.Analyser("fft", 64);

      this.chordVolume = new Tone.Volume(-8).toDestination();
      this.chordVolume.connect(this.analyser);
      this.chordReverb = new Tone.Reverb({ decay: 4, wet: 0.32 }).connect(this.chordVolume);

      this.droneVolume = new Tone.Volume(-20).toDestination();
      this.droneVolume.connect(this.analyser);

      this.piano = new Tone.Sampler({
        urls: PIANO_SAMPLE_MAP,
        baseUrl: SALAMANDER_BASE,
        release: 1.2,
      });

      // PluckSynth = Karplus-Strong physical model. PluckSynth isn't typed as
      // Monophonic so it can't go inside PolySynth — pool 6 voices manually.
      this.guitarVolume = new Tone.Volume(-4).toDestination();
      this.guitarVolume.connect(this.analyser);
      for (let i = 0; i < GUITAR_POLYPHONY; i++) {
        const voice = new Tone.PluckSynth({
          attackNoise: 0.6,
          dampening: 3800,
          resonance: 0.85,
        });
        voice.connect(this.chordReverb);
        voice.connect(this.guitarVolume);
        this.guitarPool.push(voice);
      }

      this.droneFilter = new Tone.Filter(700, "lowpass").connect(this.droneVolume);
      this.droneSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 2, decay: 0, sustain: 1, release: 3 },
      }).connect(this.droneFilter);

      await Tone.loaded();
      this.piano.connect(this.chordReverb);
      this.ready = true;
    })();

    return this.loadingPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  setBpm(bpm: number): void {
    Tone.Transport.bpm.value = bpm;
  }

  setInstrument(inst: Instrument): void {
    this.instrument = inst;
  }

  getInstrument(): Instrument {
    return this.instrument;
  }

  setChord(notes: string[]): void {
    const wasEmpty = this.currentChord.length === 0;
    const sameNotes = notes.join(",") === this.currentChord.join(",");
    this.currentChord = notes;
    if (!sameNotes) this.chordChangedAt = this.stepCounter;
    // When transitioning from silence into a chord, restart the pattern at
    // step 0 so the user always hears the downbeat of the pattern on their
    // first chord. Mid-loop chord swaps continue from where they are so the
    // groove keeps its phase.
    if (wasEmpty && notes.length > 0) this.stepCounter = 0;
  }

  setPattern(pattern: Pattern | null): void {
    this.currentPattern = pattern;
  }

  startLoop(): void {
    if (!this.ready || this.loopRunning) return;
    this.stepCounter = 0;
    this.chordChangedAt = 0;
    this.loop = new Tone.Loop((time) => {
      const chord = this.currentChord;
      const pattern = this.currentPattern;
      if (!chord.length || !pattern) {
        this.stepCounter++;
        return;
      }
      const idx = this.stepCounter % pattern.steps.length;
      const step = pattern.steps[idx];
      if (step.length) {
        const notes = notesForStep(chord, step);
        const velocity = step.length > 1 ? 0.55 : 0.7;
        if (this.instrument === "guitar" && this.guitarPool.length) {
          // PluckSynth.triggerAttack(note, time) — no velocity param;
          // overall level comes from this.guitarVolume.
          for (const note of notes) {
            const voice = this.guitarPool[this.guitarPoolIdx];
            this.guitarPoolIdx = (this.guitarPoolIdx + 1) % this.guitarPool.length;
            voice.triggerAttack(note, time);
          }
        } else if (this.piano) {
          this.piano.triggerAttackRelease(notes, "16n", time, velocity);
        }
      }
      this.stepCounter++;
    }, "8n");
    this.loop.start(0);
    if (Tone.Transport.state !== "started") Tone.Transport.start();
    this.loopRunning = true;
  }

  stopLoop(): void {
    if (this.loop) {
      this.loop.stop();
      this.loop.dispose();
      this.loop = null;
    }
    if (Tone.Transport.state === "started") Tone.Transport.stop();
    this.loopRunning = false;
    this.stepCounter = 0;
  }

  getStepIndex(): number {
    if (!this.currentPattern) return -1;
    return this.stepCounter % this.currentPattern.steps.length;
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
