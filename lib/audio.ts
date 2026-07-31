"use client";

import * as Tone from "tone";
import { Note } from "tonal";
import { ElectricPiano, Reverb, Soundfont, SplendidGrandPiano, Versilian } from "smplr";
import {
  FILLERS,
  FillerPattern,
  Instrument,
  Pattern,
  PianoFlavor,
  TENSION_SEMITONES,
  notesForStep,
} from "./theory";

type SmplrInstrument = ReturnType<typeof SplendidGrandPiano>;
type SmplrSoundfont = ReturnType<typeof Soundfont>;
type SmplrAnyPiano =
  | SmplrInstrument
  | SmplrSoundfont
  | ReturnType<typeof ElectricPiano>
  | ReturnType<typeof Versilian>;
type SmplrReverb = InstanceType<typeof Reverb>;

class AudioEngine {
  // Piano voice — currently selected flavor. Default is the Steinway D
  // (SplendidGrandPiano, 4 velocity layers). User can swap to Rhodes,
  // Wurlitzer, CP80, etc. via setPianoFlavor().
  private piano: SmplrAnyPiano | null = null;
  private pianoFlavor: PianoFlavor = "grand";
  private pianoReverb: SmplrReverb | null = null;
  private pianoGain: GainNode | null = null;
  // Parallel dry/wet routing. Piano signal fans into pianoDryGain (always
  // full, bypasses the reverb processor entirely) and pianoReverb.input
  // (its output sums via pianoWetGain). At reverb=0, only the dry path is
  // audible, so there's no reverb-processor coloration on the sample.
  private pianoSplit: GainNode | null = null;
  private pianoDryGain: GainNode | null = null;
  private pianoWetGain: GainNode | null = null;

  // Guitar: smplr Soundfont (MusyngKite acoustic_guitar_nylon) — sits on
  // the same native AudioContext as the piano so it can share the plate
  // reverb. Higher fidelity than the Tone.Sampler nbrosowsky path.
  private guitar: SmplrSoundfont | null = null;
  private guitarReverb: SmplrReverb | null = null;
  private guitarGain: GainNode | null = null;
  private guitarSplit: GainNode | null = null;
  private guitarDryGain: GainNode | null = null;
  private guitarWetGain: GainNode | null = null;

  private instrument: Instrument = "piano";

  // Track sustained note stop-fns per instrument so chord changes can release
  // the previous chord cleanly (sustain pedal behaviour: hold notes until the
  // next chord, then release in a soft tail).
  private activePianoStops: Array<() => void> = [];
  private activeGuitarStops: Array<() => void> = [];

  private droneSynth: Tone.PolySynth | null = null;
  private droneFilter: Tone.Filter | null = null;
  private droneActive = false;
  private droneNotes: string[] = [];
  private droneVolume: Tone.Volume | null = null;

  private analyser: Tone.Analyser | null = null;

  private loop: Tone.Loop | null = null;
  private currentChord: string[] = [];
  private currentPattern: Pattern | null = null;
  private currentScale: string[] = [];
  // Next chord (only known in song mode) — used for walk-up fills that
  // anticipate the upcoming chord change.
  private nextChord: string[] = [];
  private fillsEnabled = false;
  private currentFiller: FillerPattern = FILLERS[0];
  private pendingGraceNote = false;
  private stepCounter = 0;
  private loopRunning = false;
  private paused = false;
  private chordChangedAt = -1;

  // Backing track — optional per-song full-mix audio that plays under the
  // chord loop. Adds drums + bass + ambient pad so the chord-trainer feels
  // like playing with a band.
  private backingBuffer: AudioBuffer | null = null;
  private backingSource: AudioBufferSourceNode | null = null;
  private backingGain: GainNode | null = null;
  private backingPlaybackRate = 1;
  private backingSourceBpm = 0;
  private backingStartedAt = 0;
  private backingPausedAt = 0;
  private backingPlaying = false;

  // Native AudioContext we own — used everywhere we need a real
  // BaseAudioContext (smplr's AudioWorkletNodes reject standardized-audio-
  // context wrappers).
  private nativeCtx: AudioContext | null = null;

  private ready = false;
  private loadingPromise: Promise<void> | null = null;

  // Native-clock time of the last off-grid chord attack (see attackChordNow).
  // The loop uses it to skip a grid chord hit that would land right on top of
  // it and flam.
  private lastImmediateAttack = -1;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      // ONE clock for Tone and smplr.
      //
      // smplr's AudioWorkletNode rejects standardized-audio-context wrappers,
      // so we can't hand it Tone's own context — we have to own a native
      // AudioContext. But smplr's `start({ time })` is an ABSOLUTE time in
      // *its* context's clock, and Tone.Loop hands us a time in *Tone's*
      // clock. Those two clocks only agree if they're the same context:
      // importing `tone` spins up an AudioContext at page load, while ours is
      // created on the first user gesture, so Tone's currentTime runs ahead by
      // however long the page sat idle. Feeding that number to smplr
      // scheduled every note that many seconds into the future — a 90s+ delay
      // if the user read the UI before playing.
      //
      // Fix: create the native context first and give it to Tone. Both then
      // read the same currentTime. Note that the `Tone.Transport` export is
      // bound at import time to the context Tone made for itself, so every
      // reference below has to go through Tone.getTransport() to reach the
      // transport that actually belongs to this context.
      const ctx: AudioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
        latencyHint: "interactive",
      });
      if (ctx.state === "suspended") await ctx.resume();
      this.nativeCtx = ctx;

      const importTimeContext = Tone.getContext();
      Tone.setContext(ctx);
      // Free the AudioContext Tone opened at import — browsers cap how many
      // can be live at once. Deferred and caught so a failed close can't
      // reject into the init chain.
      void Promise.resolve()
        .then(() => importTimeContext.dispose())
        .catch(() => {});

      await Tone.start();
      Tone.getTransport().bpm.value = 110;

      this.analyser = new Tone.Analyser("fft", 64);

      // PIANO PATH (parallel dry/wet).
      //   piano → pianoSplit → pianoDryGain → destination   (always 100%)
      //                     → pianoReverb → pianoWetGain → destination (var)
      // The reverb processor is set to "fully wet" (dry=0) so its output is
      // only the reverb tail; we control the mix at pianoWetGain.
      this.pianoReverb = new Reverb(ctx);
      this.pianoSplit = ctx.createGain();
      this.pianoDryGain = ctx.createGain();
      this.pianoWetGain = ctx.createGain();
      this.pianoGain = ctx.createGain();
      this.pianoGain.gain.value = 0.95;

      this.pianoSplit.connect(this.pianoDryGain);
      this.pianoDryGain.connect(this.pianoGain);
      this.pianoSplit.connect(this.pianoReverb.input);
      this.pianoReverb.connect(this.pianoWetGain);
      this.pianoWetGain.connect(this.pianoGain);
      this.pianoGain.connect(ctx.destination);

      this.pianoDryGain.gain.value = 1.0;
      this.pianoWetGain.gain.value = 0.25;
      this.setReverbParams(this.pianoReverb, {
        decay: 0.72, preDelay: 0.025, wet: 1.0, dry: 0.0, damping: 0.6,
      });

      // GUITAR PATH (same parallel dry/wet topology).
      this.guitarReverb = new Reverb(ctx);
      this.guitarSplit = ctx.createGain();
      this.guitarDryGain = ctx.createGain();
      this.guitarWetGain = ctx.createGain();
      this.guitarGain = ctx.createGain();
      this.guitarGain.gain.value = 1.0;

      this.guitarSplit.connect(this.guitarDryGain);
      this.guitarDryGain.connect(this.guitarGain);
      this.guitarSplit.connect(this.guitarReverb.input);
      this.guitarReverb.connect(this.guitarWetGain);
      this.guitarWetGain.connect(this.guitarGain);
      this.guitarGain.connect(ctx.destination);

      this.guitarDryGain.gain.value = 1.0;
      this.guitarWetGain.gain.value = 0.15;
      this.setReverbParams(this.guitarReverb, { decay: 0.45, preDelay: 0.01, wet: 1.0, dry: 0.0 });

      this.droneVolume = new Tone.Volume(-20).toDestination();
      this.droneVolume.connect(this.analyser);

      this.piano = this.createPianoForFlavor(ctx, this.pianoFlavor);

      // Steel-string acoustic — the standard pop / singer-songwriter tone.
      // Brighter and more present than nylon, sits well over chord patterns.
      this.guitar = Soundfont(ctx, {
        kit: "MusyngKite",
        instrument: "acoustic_guitar_steel",
        destination: this.guitarSplit,
        volume: 110,
      });

      this.droneFilter = new Tone.Filter(700, "lowpass").connect(this.droneVolume);
      this.droneSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 2, decay: 0, sustain: 1, release: 3 },
      }).connect(this.droneFilter);

      this.backingGain = ctx.createGain();
      this.backingGain.gain.value = 0.55;
      this.backingGain.connect(ctx.destination);

      await Promise.all([
        this.piano.ready,
        this.guitar.ready,
        this.pianoReverb.ready(),
        this.guitarReverb.ready(),
        Tone.loaded(),
      ]);

      // Hold the sustain pedal down by default — gives every note a long
      // natural decay (like a pianist pedalling through a phrase). We
      // briefly tap the pedal up + down on chord changes to clear the
      // previous chord's resonance.
      this.piano?.setCC?.(64, 127);

      this.ready = true;
    })();

    return this.loadingPromise;
  }

  private createPianoForFlavor(ctx: AudioContext, flavor: PianoFlavor): SmplrAnyPiano {
    const destination = this.pianoSplit!;
    switch (flavor) {
      case "grand":
        return SplendidGrandPiano(ctx, { destination, volume: 100 });
      case "kawai":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Grand Piano, Kawai", destination, volume: 100 });
      case "steinway-b":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Grand Piano, Steinway B", destination, volume: 100 });
      case "upright-knight":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Upright Piano, Knight", destination, volume: 105 });
      case "upright-yamaha":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Upright Piano, Yamaha", destination, volume: 105 });
      case "bright":
        return Soundfont(ctx, { kit: "MusyngKite", instrument: "bright_acoustic_piano", destination, volume: 105 });
      case "honkytonk":
        return Soundfont(ctx, { kit: "MusyngKite", instrument: "honkytonk_piano", destination, volume: 105 });
      case "rhodes":
        return Soundfont(ctx, { kit: "MusyngKite", instrument: "electric_piano_1", destination, volume: 110 });
      case "wurli":
        return ElectricPiano(ctx, { instrument: "WurlitzerEP200", destination, volume: 105 });
      case "cp80":
        return ElectricPiano(ctx, { instrument: "CP80", destination, volume: 105 });
    }
  }

  async setPianoFlavor(flavor: PianoFlavor): Promise<void> {
    if (this.pianoFlavor === flavor) return;
    this.pianoFlavor = flavor;
    if (!this.ready || !this.nativeCtx || !this.pianoReverb) return;
    // Release any sounding voices, then dispose and rebuild the instrument.
    this.releasePianoVoices();
    try { this.piano?.disconnect?.(); } catch {}
    this.piano = this.createPianoForFlavor(this.nativeCtx, flavor);
    await this.piano.ready;
    this.piano.setCC?.(64, 127); // sustain pedal back on
  }

  getPianoFlavor(): PianoFlavor {
    return this.pianoFlavor;
  }

  // 0..1 — fraction of reverb in the piano signal. The dry path is on a
  // parallel route that bypasses the reverb processor entirely, so 0 = bone
  // dry with no processor coloration.
  setPianoReverbAmount(amount: number): void {
    const clamped = Math.max(0, Math.min(1, amount));
    if (this.pianoWetGain) this.pianoWetGain.gain.value = clamped * 0.55;
    if (this.pianoReverb) {
      this.setReverbParams(this.pianoReverb, {
        decay: 0.55 + clamped * 0.35,
        preDelay: 0.015 + clamped * 0.04,
      });
    }
  }

  setGuitarReverbAmount(amount: number): void {
    const clamped = Math.max(0, Math.min(1, amount));
    if (this.guitarWetGain) this.guitarWetGain.gain.value = clamped * 0.35;
    if (this.guitarReverb) {
      this.setReverbParams(this.guitarReverb, {
        decay: 0.3 + clamped * 0.3,
      });
    }
  }

  private setReverbParams(
    rev: SmplrReverb,
    params: { decay?: number; preDelay?: number; wet?: number; dry?: number; damping?: number },
  ): void {
    for (const [name, value] of Object.entries(params)) {
      const p = rev.getParam(name as "decay");
      if (p && value != null) p.value = value;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  // Tone.Loop hands out times on Tone's clock; smplr schedules on ours. Since
  // init() points Tone at the same AudioContext these are identical, and this
  // returns `toneTime` untouched. It exists so that if the two ever end up on
  // separate contexts again the notes stay on time instead of silently
  // scheduling seconds into the future.
  private toNativeTime(toneTime: number): number {
    const ctx = this.nativeCtx;
    if (!ctx) return toneTime;
    const skew = Tone.getContext().currentTime - ctx.currentTime;
    return Math.abs(skew) < 0.005 ? toneTime : toneTime - skew;
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
    // Keep the backing track stretched to the new tempo. Adjusting an
    // already-playing AudioBufferSourceNode's playbackRate is allowed and
    // takes effect immediately.
    if (this.backingSourceBpm > 0) {
      this.backingPlaybackRate = bpm / this.backingSourceBpm;
      if (this.backingSource) {
        this.backingSource.playbackRate.value = this.backingPlaybackRate;
      }
    }
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
    if (!sameNotes) {
      this.chordChangedAt = this.stepCounter;
      this.pendingGraceNote = !wasEmpty; // fill grace only on chord-to-chord change, not initial attack
      // Pedal lift + release of previous voices, then pedal back down for
      // the new chord — exactly what a pianist does between chords.
      this.releasePianoVoices();
      if (this.piano && this.ready) {
        this.piano.setCC?.(64, 0);
        // Tiny defer (next macrotask) so the pedal-up actually clears
        // before we press it again.
        setTimeout(() => this.piano?.setCC?.(64, 127), 30);
      }
      this.attackChordNow(notes);
    }
    if (wasEmpty && notes.length > 0) this.stepCounter = 0;
  }

  // Sound a new chord immediately instead of waiting for the pattern's next
  // chord step. Patterns only strike the full chord on the steps that carry a
  // chord token — "Hold" has exactly one (step 0), "Block" and "Pop" two —
  // so on the grid alone a chord change can sit silent for most of a bar
  // (~2s at 100bpm) while the previous chord has already been released. That
  // gap reads as lag, not as musical timing. The grid keeps running
  // underneath; this just gives the gesture an instant response.
  private attackChordNow(notes: string[]): void {
    const ctx = this.nativeCtx;
    if (!this.ready || !ctx || this.paused || notes.length === 0) return;

    const time = ctx.currentTime;
    this.lastImmediateAttack = time;

    if (this.instrument === "guitar") {
      // Light strum rather than a block hit — a guitarist can't sound six
      // strings simultaneously and the spread keeps fast chord sweeps legible.
      notes.forEach((note, i) => {
        const stop = this.guitar?.start({
          note,
          time: time + i * 0.012,
          velocity: 70,
          duration: 3.2,
        });
        if (stop) this.activeGuitarStops.push(stop as () => void);
      });
    } else {
      for (const note of notes) {
        const stop = this.piano?.start({ note, time, velocity: 64, duration: 6.0 });
        if (stop) this.activePianoStops.push(stop as () => void);
      }
    }
  }

  setPattern(pattern: Pattern | null): void {
    this.currentPattern = pattern;
  }

  setScale(scaleNotes: string[]): void {
    this.currentScale = scaleNotes;
  }

  setNextChord(notes: string[]): void {
    this.nextChord = notes;
  }

  setFillsEnabled(on: boolean): void {
    this.fillsEnabled = on;
  }

  setFiller(filler: FillerPattern): void {
    this.currentFiller = filler;
  }

  startLoop(): void {
    if (!this.ready || this.loopRunning) return;
    this.stepCounter = 0;
    this.chordChangedAt = 0;
    this.loop = new Tone.Loop((toneTime) => {
      if (this.paused) return;
      const chord = this.currentChord;
      const pattern = this.currentPattern;
      if (!chord.length || !pattern) {
        this.stepCounter++;
        return;
      }
      // Every `start({ time })` below is an absolute time on the smplr
      // context's clock, so translate out of Tone's before scheduling.
      const time = this.toNativeTime(toneTime);
      const idx = this.stepCounter % pattern.steps.length;
      const step = pattern.steps[idx];
      const barSec8th = 60 / Tone.getTransport().bpm.value / 2;

      // FILLS — 4-note filler on the last half-bar leading into the next
      // chord, plus a grace-note octave-up root on the first beat of the
      // new chord. Only fires in song mode (when we know what's coming).
      // All concrete fillers are 4 steps; "random" has 0 steps but resolves
      // to a 4-step concrete filler inside triggerFiller, so we use 4 as
      // the trigger offset regardless.
      const FILLER_LEN = 4;
      if (
        this.fillsEnabled &&
        this.nextChord.length > 0 &&
        idx === pattern.steps.length - FILLER_LEN
      ) {
        this.triggerFiller(time, barSec8th);
      }
      if (this.fillsEnabled && this.pendingGraceNote && chord.length > 0) {
        this.triggerGraceNote(time, chord);
        this.pendingGraceNote = false;
      }

      // Bass drone — at the start of each pattern cycle, trigger TWO root
      // notes (octave-down + two-octaves-down) that sustain for the full
      // cycle. The octave doubling matches the typical pop/rock piano
      // score's two-stacked-whole-notes bass and gives a dramatic anchor.
      if (idx === 0 && pattern.bassDrone && chord.length > 0) {
        const barSec = 60 / Tone.getTransport().bpm.value / 2;
        const cycleSec = pattern.steps.length * barSec;
        const bass1 = notesForStep(chord, [-1], this.currentScale)[0];
        const bass2 = bass1 ? this.dropOctave(bass1) : null;
        const inst = this.instrument === "guitar" ? this.guitar : this.piano;
        for (const [note, vel] of [
          [bass1, 60] as const,
          [bass2, 70] as const, // lower octave a touch louder for body
        ]) {
          if (!note) continue;
          const stop = inst?.start({ note, time, velocity: vel, duration: cycleSec });
          if (stop) {
            if (this.instrument === "guitar") this.activeGuitarStops.push(stop as () => void);
            else this.activePianoStops.push(stop as () => void);
          }
        }
      }

      if (step.length) {
        const notes = notesForStep(chord, step, this.currentScale);
        const isFullChord = step.length > 1 || step[0] === 0;

        // attackChordNow() just sounded this chord off-grid. If the grid's own
        // chord hit lands within a flam's distance of it, drop the grid hit —
        // otherwise a chord change a hair before the beat double-strikes.
        if (isFullChord && time - this.lastImmediateAttack < 0.09) {
          this.stepCounter++;
          return;
        }

        // Velocity dynamics — downbeats louder, off-beats softer, with a
        // little randomization so it feels human rather than sequenced.
        const onBeat = idx % 2 === 0;
        const isDownbeat = idx === 0 || idx === pattern.steps.length / 2;
        const baseVel = isFullChord ? 58 : 78;
        const beatBoost = isDownbeat ? 22 : onBeat ? 12 : -4;
        const jitter = (Math.random() - 0.5) * 10;
        const velocity = Math.max(28, Math.min(110, baseVel + beatBoost + jitter));

        // Timing humanization — ±4ms jitter on every hit. Tiny enough to
        // not lose the groove, big enough to sound less robotic.
        const timeJitter = (Math.random() - 0.5) * 0.004;
        const noteTime = Math.max(time + timeJitter, time);

        // Both instruments now use the smplr `start({note, time, velocity})`
        // API. Guitar gets longer ring-out (nylon strings decay slowly);
        // piano gets a tighter duration so chord changes don't muddy.
        if (this.instrument === "guitar") {
          const duration = isFullChord ? 3.2 : 2.4;
          for (const note of notes) {
            const stop = this.guitar?.start({ note, time: noteTime, velocity, duration });
            if (stop) this.activeGuitarStops.push(stop as () => void);
          }
          if (this.activeGuitarStops.length > 64) {
            const overflow = this.activeGuitarStops.splice(0, this.activeGuitarStops.length - 64);
            for (const s of overflow) try { s(); } catch {}
          }
        } else {
          // Long duration — the pedal-down sustain + release-sample tail
          // gives notes a natural decay. They get hard-cut on chord change
          // by releasePianoVoices(), so this number just caps how long a
          // held note can ring if the user never moves to a new chord.
          const duration = isFullChord ? 6.0 : 4.0;
          for (const note of notes) {
            const stop = this.piano?.start({ note, time: noteTime, velocity, duration });
            if (stop) this.activePianoStops.push(stop as () => void);
          }
          if (this.activePianoStops.length > 64) {
            const overflow = this.activePianoStops.splice(0, this.activePianoStops.length - 64);
            for (const s of overflow) try { s(); } catch {}
          }
        }
      }
      this.stepCounter++;
    }, "8n");
    this.loop.start(0);
    if (Tone.getTransport().state !== "started") Tone.getTransport().start();
    this.loopRunning = true;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) {
      this.releasePianoVoices();
      this.releaseGuitarVoices();
      this.pauseBackingTrack();
    } else if (this.backingBuffer && !this.backingPlaying && this.backingPausedAt > 0) {
      this.resumeBackingTrack();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  // Schedule a filler — 4 8th-note tokens resolved against the SONG TONIC
  // (not the next chord), so the same fill plays the same notes regardless
  // of which chord is coming. This keeps fills consistently in-key.
  //
  // If currentFiller.id === "random", picks a random concrete filler each
  // fire and has a 25% skip chance, giving fills a human, non-robotic
  // texture across the song.
  private triggerFiller(time: number, barSec8th: number): void {
    if (!this.piano || this.currentScale.length !== 7) return;

    // Resolve which filler actually plays.
    let filler: FillerPattern = this.currentFiller;
    if (filler.id === "random") {
      if (Math.random() < 0.25) return; // skip — fills shouldn't be on every bar
      const pool = FILLERS.filter((f) => f.id !== "random");
      filler = pool[Math.floor(Math.random() * pool.length)];
    }

    // Build a virtual tonic chord to use as the resolution basis for the
    // existing scale walker. notesForStep walks the scale from chord[0],
    // so passing [tonic4] makes token 1 = tonic, 8 = tonic↑, etc.
    const tonicPc = this.currentScale[0];
    const tonicBase = [`${tonicPc}4`];
    const tonicMidi = Note.midi(`${tonicPc}4`);

    for (let i = 0; i < filler.steps.length; i++) {
      const token = filler.steps[i];
      let note: string | null = null;

      if (typeof token === "string") {
        // Tension semitones are relative to TONIC (not chord) — gives a
        // fixed jazz-color note in the key (e.g. #11 = #4 of the key).
        const semis = TENSION_SEMITONES[token];
        if (semis != null && tonicMidi != null) {
          note = Note.fromMidi(tonicMidi + semis);
        }
      } else if (token === 0) {
        continue;
      } else {
        const resolved = notesForStep(tonicBase, [token], this.currentScale);
        note = resolved[0] ?? null;
      }

      if (!note) continue;
      const stop = this.piano.start({
        note,
        time: time + i * barSec8th,
        velocity: 52,
        duration: barSec8th * 1.4,
      });
      if (stop) this.activePianoStops.push(stop as () => void);
    }
  }

  // Quick high-register root grace note when a new chord starts — propels
  // the chord change.
  private triggerGraceNote(time: number, chord: string[]): void {
    if (!this.piano) return;
    const rootPc = chord[0]?.replace(/\d+$/, "");
    if (!rootPc) return;
    const stop = this.piano.start({
      note: `${rootPc}6`,
      time,
      velocity: 55,
      duration: 0.6,
    });
    if (stop) this.activePianoStops.push(stop as () => void);
  }

  // "C3" → "C2", clamped at octave 0.
  private dropOctave(note: string): string {
    const m = note.match(/^([A-G][#b]?)(\d+)$/);
    if (!m) return note;
    const oct = Math.max(0, parseInt(m[2], 10) - 1);
    return `${m[1]}${oct}`;
  }

  private releasePianoVoices(): void {
    for (const s of this.activePianoStops) {
      try { s(); } catch {}
    }
    this.activePianoStops = [];
  }

  private releaseGuitarVoices(): void {
    for (const s of this.activeGuitarStops) {
      try { s(); } catch {}
    }
    this.activeGuitarStops = [];
  }

  stopLoop(): void {
    if (this.loop) {
      this.loop.stop();
      this.loop.dispose();
      this.loop = null;
    }
    if (Tone.getTransport().state === "started") Tone.getTransport().stop();
    this.loopRunning = false;
    this.stepCounter = 0;
    this.releasePianoVoices();
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

  // --- Backing track (drum+bass+pad stem) -----------------------------------

  async loadBackingTrack(url: string, sourceBpm: number = 110): Promise<boolean> {
    if (!this.ready) await this.init();
    const ctx = this.nativeCtx!;
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const arr = await res.arrayBuffer();
      this.backingBuffer = await ctx.decodeAudioData(arr);
      this.backingSourceBpm = sourceBpm;
      this.backingPlaybackRate = Tone.getTransport().bpm.value / sourceBpm;
      return true;
    } catch {
      this.backingBuffer = null;
      this.backingSourceBpm = 0;
      return false;
    }
  }

  hasBackingTrack(): boolean {
    return this.backingBuffer != null;
  }

  playBackingTrack(): void {
    if (!this.backingBuffer || !this.backingGain) return;
    if (this.backingPlaying) return;
    const ctx = this.nativeCtx!;
    const src = ctx.createBufferSource();
    src.buffer = this.backingBuffer;
    src.playbackRate.value = this.backingPlaybackRate;
    src.loop = true;
    src.connect(this.backingGain);
    const offset = this.backingPausedAt > 0 ? this.backingPausedAt : 0;
    src.start(0, offset);
    this.backingSource = src;
    this.backingStartedAt = ctx.currentTime - offset / this.backingPlaybackRate;
    this.backingPlaying = true;
  }

  pauseBackingTrack(): void {
    if (!this.backingSource || !this.backingPlaying) return;
    const ctx = this.nativeCtx!;
    const elapsed = (ctx.currentTime - this.backingStartedAt) * this.backingPlaybackRate;
    this.backingPausedAt = elapsed % (this.backingBuffer?.duration ?? 0);
    try { this.backingSource.stop(); } catch {}
    this.backingSource.disconnect();
    this.backingSource = null;
    this.backingPlaying = false;
  }

  private resumeBackingTrack(): void {
    this.playBackingTrack();
  }

  stopBackingTrack(): void {
    this.pauseBackingTrack();
    this.backingPausedAt = 0;
    this.backingBuffer = null;
    this.backingSourceBpm = 0;
  }

  setBackingVolume(gain: number): void {
    if (this.backingGain) this.backingGain.gain.value = Math.max(0, Math.min(1.5, gain));
  }
}

let engineSingleton: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineSingleton) engineSingleton = new AudioEngine();
  return engineSingleton;
}
