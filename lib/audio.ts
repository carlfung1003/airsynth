"use client";

import * as Tone from "tone";
import { Note } from "tonal";
import { ElectricPiano, Soundfont, SplendidGrandPiano, Versilian } from "smplr";
import {
  FILLERS,
  FillerPattern,
  Instrument,
  Pattern,
  PianoFlavor,
  PIANO_FLAVORS,
  TENSION_SEMITONES,
  notesForStep,
} from "./theory";

type SmplrSoundfont = ReturnType<typeof Soundfont>;
type SmplrAnyPiano =
  | ReturnType<typeof SplendidGrandPiano>
  | SmplrSoundfont
  | ReturnType<typeof ElectricPiano>
  | ReturnType<typeof Versilian>;
type LoadProgress = { loaded: number; total: number };

export type EngineStatus = {
  /** Sample loading for the selected instrument. */
  load: "idle" | "loading" | "ready" | "error";
  /** 0..1 while loading. */
  progress: number;
  /** What is loading ("Grand piano", "Acoustic guitar"). */
  label: string;
  error?: string;
  /** AudioContext state. iOS reports "interrupted" after a call / Siri /
   *  backgrounding; anything but "running" means a tap is needed. */
  context: AudioContextState | "interrupted" | "none";
};

// How long a sample set may take before we call it failed and let the user
// retry, instead of sitting on "Loading…" forever on a bad connection.
const LOAD_TIMEOUT_MS = 60_000;
const MASTER_GAIN = 0.95;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} took too long to load`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// 0.25 s of 8-bit silence as a WAV data URI. Playing an HTML <audio> element
// moves an iOS page into the "playback" audio-session category, which is what
// lets Web Audio be heard with the ringer switch on silent (iOS < 17; newer
// iOS uses navigator.audioSession instead).
function silentWavDataUri(): string {
  const sampleRate = 8000;
  const n = 2000;
  const buf = new Uint8Array(44 + n);
  const dv = new DataView(buf.buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
  };
  w(0, "RIFF");
  dv.setUint32(4, 36 + n, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  w(36, "data");
  dv.setUint32(40, n, true);
  buf.fill(128, 44);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(s)}`;
}

// Stereo impulse response for the room: decorrelated noise with an RT60
// envelope, a lowpass that closes as the tail decays (highs die first, like a
// real hall), and a few early reflections that differ per channel for width.
// Normalised to unit energy so a send level reads the same whatever the RT60.
//
// This replaces smplr's AudioWorklet reverb: that one needs AudioWorklet
// (missing or flaky on older iOS, and a failed addModule() used to wedge the
// whole engine), and its getParam() returns "preDelay" for every name, so the
// wet/dry settings we wrote to it never landed.
function buildImpulse(ctx: BaseAudioContext, seconds: number, rt60: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.pow(10, (-3 * t) / rt60);
      const damp = 0.82 * Math.exp(-t / (rt60 * 0.4)) + 0.07;
      lp += damp * (Math.random() * 2 - 1 - lp);
      const swell = Math.min(1, t / 0.014);
      d[i] = lp * env * swell;
    }
    const taps = ch === 0 ? [0.011, 0.019, 0.029, 0.041, 0.057] : [0.014, 0.022, 0.033, 0.046, 0.061];
    taps.forEach((tt, k) => {
      const idx = Math.floor(tt * rate);
      if (idx < len) d[idx] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.7, k);
    });
    let energy = 0;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const norm = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return ir;
}

class AudioEngine {
  private nativeCtx: AudioContext | null = null;

  // Signal path (all native nodes on one AudioContext, shared with Tone's
  // clock; see ensureContext):
  //   piano  → pianoIn  ─┬→ bus → glue comp → limiter → master → out
  //   guitar → guitarIn ─┤        (reverb return, backing, clicks, drone
  //                      └→ send → reverb (pre-delay → HP → convolver → LP) ─┘
  private bus: GainNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;
  private reverbIn: GainNode | null = null;
  private pianoIn: GainNode | null = null;
  private pianoSend: GainNode | null = null;
  private guitarIn: GainNode | null = null;
  private guitarSend: GainNode | null = null;
  private clickGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private backingGain: GainNode | null = null;

  private piano: SmplrAnyPiano | null = null;
  private pianoFlavor: PianoFlavor = "grand";
  private pianoLoad: Promise<void> | null = null;
  private pianoLoadedFlavor: PianoFlavor | null = null;
  private guitar: SmplrSoundfont | null = null;
  private guitarLoad: Promise<void> | null = null;
  private guitarLoaded = false;

  private instrument: Instrument = "piano";

  // Sounding voices per instrument, so a chord change can release the last
  // chord the way a pianist lifts the pedal.
  private activePianoStops: Array<() => void> = [];
  private activeGuitarStops: Array<() => void> = [];

  private droneVoices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private droneKey = "";

  private loop: Tone.Loop | null = null;
  private currentChord: string[] = [];
  private currentPattern: Pattern | null = null;
  private currentScale: string[] = [];
  // Next chord (song modes only), used for walk-up fills into the change.
  private nextChord: string[] = [];
  private fillsEnabled = false;
  private currentFiller: FillerPattern = FILLERS[0];
  private pendingGraceNote = false;
  private stepCounter = 0;
  // Perform mode keeps the pattern grid on the song's bars: the pattern index
  // counts from the downbeat after the count-in, and a first chord doesn't
  // restart the figure the way it does in free play.
  private stepOffset = 0;
  private gridLocked = false;
  private loopRunning = false;
  private paused = false;

  // Backing track: optional full-mix stem under the chord loop.
  private backingBuffer: AudioBuffer | null = null;
  private backingSource: AudioBufferSourceNode | null = null;
  private backingPlaybackRate = 1;
  private backingSourceBpm = 0;
  private backingStartedAt = 0;
  private backingPausedAt = 0;
  private backingPlaying = false;

  private ready = false;
  private loadingPromise: Promise<void> | null = null;

  // Native-clock time of the last off-grid chord attack (attackChordNow); the
  // loop skips a grid chord hit that would land on top of it and flam.
  private lastImmediateAttack = -1;

  private sessionEl: HTMLAudioElement | null = null;
  private lifecycleAttached = false;
  private status: EngineStatus = { load: "idle", progress: 0, label: "", context: "none" };
  private listeners = new Set<() => void>();

  // ── Status (for useSyncExternalStore) ──────────────────────────────────

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getStatus = (): EngineStatus => this.status;

  private setStatus(patch: Partial<EngineStatus>): void {
    const next = { ...this.status, ...patch };
    if (
      next.load === this.status.load &&
      next.progress === this.status.progress &&
      next.label === this.status.label &&
      next.error === this.status.error &&
      next.context === this.status.context
    ) {
      return;
    }
    this.status = next;
    for (const l of this.listeners) l();
  }

  // ── Unlock (mobile) ─────────────────────────────────────────────────────

  /**
   * Call SYNCHRONOUSLY from a click / touchend / keydown handler, before any
   * await. iOS only lets a page start audio inside a user gesture: an
   * AudioContext created or resumed later (after a camera prompt, a fetch,
   * a sample load) stays suspended, and Web Audio is muted by the ringer
   * switch unless the page claims the "playback" audio session.
   */
  unlock(): void {
    if (typeof window === "undefined") return;
    const ctx = this.ensureContext();
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    // WebKit un-mutes a context once a source has actually started on it
    // inside the gesture; a one-sample silent buffer is enough.
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {}
    this.claimPlaybackSession();
    this.attachLifecycle();
    this.syncContextState();
  }

  private claimPlaybackSession(): void {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = "playback";
      } catch {}
      return;
    }
    if (!isAppleTouchDevice()) return;
    if (!this.sessionEl) {
      const el = document.createElement("audio");
      el.src = silentWavDataUri();
      el.loop = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("x-webkit-airplay", "deny");
      el.preload = "auto";
      this.sessionEl = el;
    }
    void this.sessionEl.play().catch(() => {});
  }

  private attachLifecycle(): void {
    if (this.lifecycleAttached || !this.nativeCtx) return;
    this.lifecycleAttached = true;
    // The events WebKit accepts as activation for resume(). touchstart and
    // pointerdown are NOT on that list, so listening to them does nothing.
    const kick = () => this.resumeIfNeeded();
    for (const type of ["touchend", "pointerup", "click", "keydown"] as const) {
      window.addEventListener(type, kick, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.resumeIfNeeded();
      else this.sessionEl?.pause();
    });
    this.nativeCtx.addEventListener("statechange", () => this.syncContextState());
  }

  private syncContextState(): void {
    this.setStatus({ context: (this.nativeCtx?.state as EngineStatus["context"]) ?? "none" });
  }

  /** Resume after an iOS interruption; safe to call from any tap. */
  resumeIfNeeded(): void {
    const ctx = this.nativeCtx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    void ctx.resume().catch(() => {});
    this.claimPlaybackSession();
  }

  private ensureContext(): AudioContext {
    if (this.nativeCtx) return this.nativeCtx;
    // ONE clock for Tone and smplr. smplr's start({ time }) is absolute time
    // on the context we hand it, and Tone.Loop gives times on Tone's clock;
    // they only agree if they are the same context. Importing `tone` opens a
    // context at page load, so we create ours and give it to Tone. Every
    // Transport reference must go through Tone.getTransport(): the
    // `Tone.Transport` export is bound to the import-time context.
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.nativeCtx = ctx;
    const importTimeContext = Tone.getContext();
    Tone.setContext(ctx);
    void Promise.resolve()
      .then(() => importTimeContext.dispose())
      .catch(() => {});
    Tone.getTransport().bpm.value = 110;
    this.buildGraph(ctx);
    return ctx;
  }

  private buildGraph(ctx: AudioContext): void {
    this.bus = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 10;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.012;
    glue.release.value = 0.22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this.analyserBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.bus.connect(glue);
    glue.connect(limiter);
    limiter.connect(this.master);
    this.master.connect(ctx.destination);
    this.master.connect(this.analyser);

    this.reverbIn = ctx.createGain();
    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.024;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 170;
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = buildImpulse(ctx, 2.6, 2.1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6800;
    this.reverbIn.connect(preDelay);
    preDelay.connect(hp);
    hp.connect(convolver);
    convolver.connect(lp);
    lp.connect(this.bus);

    this.pianoIn = ctx.createGain();
    this.pianoIn.gain.value = 0.95;
    this.pianoSend = ctx.createGain();
    this.pianoSend.gain.value = 0.22;
    this.pianoIn.connect(this.bus);
    this.pianoIn.connect(this.pianoSend);
    this.pianoSend.connect(this.reverbIn);

    this.guitarIn = ctx.createGain();
    this.guitarIn.gain.value = 1.0;
    this.guitarSend = ctx.createGain();
    this.guitarSend.gain.value = 0.14;
    this.guitarIn.connect(this.bus);
    this.guitarIn.connect(this.guitarSend);
    this.guitarSend.connect(this.reverbIn);

    this.clickGain = ctx.createGain();
    this.clickGain.gain.value = 0.5;
    this.clickGain.connect(this.bus);

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 1;
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = "lowpass";
    droneLp.frequency.value = 700;
    this.droneGain.connect(droneLp);
    droneLp.connect(this.bus);

    this.backingGain = ctx.createGain();
    this.backingGain.gain.value = 0.55;
    this.backingGain.connect(this.bus);
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  /**
   * Load the selected instrument. The context itself is created by unlock();
   * init() never awaits resume(), because on iOS a resume() outside a gesture
   * returns a promise that never settles, and that used to leave the app on
   * "Loading piano samples…" for good. Samples decode fine while suspended.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.loadingPromise) return this.loadingPromise;
    const ctx = this.ensureContext();
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    this.attachLifecycle();
    this.syncContextState();
    this.loadingPromise = (async () => {
      await this.ensureInstrumentLoaded(this.instrument);
      this.ready = true;
    })().catch((err: unknown) => {
      // Let the next call retry instead of returning this rejection forever.
      this.loadingPromise = null;
      throw err;
    });
    return this.loadingPromise;
  }

  private ensureInstrumentLoaded(inst: Instrument): Promise<void> {
    return inst === "guitar" ? this.loadGuitar() : this.loadPiano(this.pianoFlavor);
  }

  private trackLoad(label: string, work: (onProgress: (p: LoadProgress) => void) => Promise<void>): Promise<void> {
    this.setStatus({ load: "loading", progress: 0, label, error: undefined });
    const onProgress = (p: LoadProgress) => {
      if (p.total > 0) this.setStatus({ progress: Math.min(1, p.loaded / p.total) });
    };
    return work(onProgress).then(
      () => this.setStatus({ load: "ready", progress: 1, label }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.setStatus({ load: "error", error: message, label });
        throw err;
      },
    );
  }

  private loadPiano(flavor: PianoFlavor): Promise<void> {
    if (this.pianoLoadedFlavor === flavor && this.piano) return Promise.resolve();
    if (this.pianoLoad) return this.pianoLoad;
    const ctx = this.ensureContext();
    const label = PIANO_FLAVORS.find((f) => f.id === flavor)?.label ?? "Piano";
    this.pianoLoad = this.trackLoad(`${label} piano`, async (onLoadProgress) => {
      this.releasePianoVoices();
      try {
        this.piano?.disconnect?.();
      } catch {}
      const piano = this.createPianoForFlavor(ctx, flavor, onLoadProgress);
      this.piano = piano;
      await withTimeout(piano.load, LOAD_TIMEOUT_MS, label);
      // Sustain pedal down by default: every note gets its natural decay;
      // chord changes tap the pedal up and down to clear the last chord.
      piano.setCC?.(64, 127);
      this.pianoLoadedFlavor = flavor;
    }).finally(() => {
      this.pianoLoad = null;
    });
    return this.pianoLoad;
  }

  private loadGuitar(): Promise<void> {
    if (this.guitarLoaded) return Promise.resolve();
    if (this.guitarLoad) return this.guitarLoad;
    const ctx = this.ensureContext();
    this.guitarLoad = this.trackLoad("Acoustic guitar", async (onLoadProgress) => {
      // Steel-string acoustic: the standard pop / singer-songwriter tone.
      const guitar = Soundfont(ctx, {
        kit: "MusyngKite",
        instrument: "acoustic_guitar_steel",
        destination: this.guitarIn!,
        volume: 110,
        onLoadProgress,
      });
      this.guitar = guitar;
      await withTimeout(guitar.load, LOAD_TIMEOUT_MS, "Guitar");
      this.guitarLoaded = true;
    }).finally(() => {
      this.guitarLoad = null;
    });
    return this.guitarLoad;
  }

  private createPianoForFlavor(
    ctx: AudioContext,
    flavor: PianoFlavor,
    onLoadProgress: (p: LoadProgress) => void,
  ): SmplrAnyPiano {
    const destination = this.pianoIn!;
    switch (flavor) {
      case "grand":
        return SplendidGrandPiano(ctx, { destination, volume: 100, onLoadProgress });
      case "kawai":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Grand Piano, Kawai", destination, volume: 100, onLoadProgress });
      case "steinway-b":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Grand Piano, Steinway B", destination, volume: 100, onLoadProgress });
      case "upright-knight":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Upright Piano, Knight", destination, volume: 105, onLoadProgress });
      case "upright-yamaha":
        return Versilian(ctx, { instrument: "Chordophones/Zithers/Upright Piano, Yamaha", destination, volume: 105, onLoadProgress });
      case "bright":
        return Soundfont(ctx, { kit: "MusyngKite", instrument: "bright_acoustic_piano", destination, volume: 105, onLoadProgress });
      case "honkytonk":
        return Soundfont(ctx, { kit: "MusyngKite", instrument: "honkytonk_piano", destination, volume: 105, onLoadProgress });
      case "rhodes":
        return Soundfont(ctx, { kit: "MusyngKite", instrument: "electric_piano_1", destination, volume: 110, onLoadProgress });
      case "wurli":
        return ElectricPiano(ctx, { instrument: "WurlitzerEP200", destination, volume: 105, onLoadProgress });
      case "cp80":
        return ElectricPiano(ctx, { instrument: "CP80", destination, volume: 105, onLoadProgress });
    }
  }

  async setPianoFlavor(flavor: PianoFlavor): Promise<void> {
    if (this.pianoFlavor === flavor) return;
    this.pianoFlavor = flavor;
    if (!this.nativeCtx) return;
    // A load for the old flavor may be in flight; wait it out, then swap.
    if (this.pianoLoad) await this.pianoLoad.catch(() => {});
    if (this.pianoFlavor !== flavor) return;
    await this.loadPiano(flavor).catch(() => {});
  }

  getPianoFlavor(): PianoFlavor {
    return this.pianoFlavor;
  }

  /** Retry after a failed load (offline, timeout). */
  retryLoad(): Promise<void> {
    if (!this.ready) return this.init();
    return this.ensureInstrumentLoaded(this.instrument);
  }

  // 0..1 reverb send. The dry path never passes through the reverb, so 0 is
  // bone dry.
  setPianoReverbAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    if (this.pianoSend) this.pianoSend.gain.value = a * 0.55;
  }

  setGuitarReverbAmount(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    if (this.guitarSend) this.guitarSend.gain.value = a * 0.35;
  }

  isReady(): boolean {
    return this.ready;
  }

  // Tone.Loop hands out times on Tone's clock; smplr schedules on ours. They
  // are the same context (ensureContext), so this returns toneTime untouched;
  // it exists so a future context split would stay on time instead of
  // silently scheduling seconds into the future.
  private toNativeTime(toneTime: number): number {
    const ctx = this.nativeCtx;
    if (!ctx) return toneTime;
    const skew = Tone.getContext().currentTime - ctx.currentTime;
    return Math.abs(skew) < 0.005 ? toneTime : toneTime - skew;
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
    // Keep a backing track stretched to the new tempo.
    if (this.backingSourceBpm > 0) {
      this.backingPlaybackRate = bpm / this.backingSourceBpm;
      if (this.backingSource) this.backingSource.playbackRate.value = this.backingPlaybackRate;
    }
  }

  setInstrument(inst: Instrument): void {
    if (this.instrument === inst) return;
    this.releasePianoVoices();
    this.releaseGuitarVoices();
    this.instrument = inst;
    if (this.nativeCtx) void this.ensureInstrumentLoaded(inst).catch(() => {});
  }

  getInstrument(): Instrument {
    return this.instrument;
  }

  setChord(notes: string[]): void {
    const wasEmpty = this.currentChord.length === 0;
    const sameNotes = notes.join(",") === this.currentChord.join(",");
    this.currentChord = notes;
    if (!sameNotes) {
      this.pendingGraceNote = !wasEmpty; // grace note only chord-to-chord
      // Pedal up (release the last chord), then down again for this one.
      this.releasePianoVoices();
      this.releaseGuitarVoices();
      if (this.piano && this.ready) {
        this.piano.setCC?.(64, 0);
        setTimeout(() => this.piano?.setCC?.(64, 127), 30);
      }
      this.attackChordNow(notes);
    }
    if (wasEmpty && notes.length > 0 && !this.gridLocked) this.stepCounter = 0;
  }

  // Sound a new chord immediately instead of waiting for the pattern's next
  // chord step. Patterns strike the full chord only on steps that carry a
  // chord token ("Hold" has one per bar), so on the grid alone a change could
  // sit silent for most of a bar. The grid keeps running underneath; this
  // just gives the gesture an instant response.
  private attackChordNow(notes: string[]): void {
    const ctx = this.nativeCtx;
    if (!this.ready || !ctx || this.paused || notes.length === 0) return;

    const time = ctx.currentTime;
    this.lastImmediateAttack = time;

    if (this.instrument === "guitar") {
      // A light strum, not a block: a guitarist can't sound six strings at
      // once, and the spread keeps fast chord sweeps legible.
      notes.forEach((note, i) => {
        const stop = this.guitar?.start({ note, time: time + i * 0.012, velocity: 70, duration: 3.2 });
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

  private patternStep(len: number): number {
    const n = this.stepCounter - this.stepOffset;
    return ((n % len) + len) % len;
  }

  startLoop(): void {
    if (!this.ready || this.loopRunning) return;
    if (!this.gridLocked) this.stepCounter = 0;
    this.loop = new Tone.Loop((toneTime) => {
      if (this.paused) return;
      const chord = this.currentChord;
      const pattern = this.currentPattern;
      if (!chord.length || !pattern) {
        this.stepCounter++;
        return;
      }
      const time = this.toNativeTime(toneTime);
      const idx = this.patternStep(pattern.steps.length);
      const step = pattern.steps[idx];
      const barSec8th = 60 / Tone.getTransport().bpm.value / 2;

      // FILLS: a 4-note filler over the last half-bar into the next chord,
      // plus a grace-note octave root on the new chord's first beat. Song
      // modes only (we need to know what's coming).
      const FILLER_LEN = 4;
      if (this.fillsEnabled && this.nextChord.length > 0 && idx === pattern.steps.length - FILLER_LEN) {
        this.triggerFiller(time, barSec8th);
      }
      if (this.fillsEnabled && this.pendingGraceNote && chord.length > 0) {
        this.triggerGraceNote(time, chord);
        this.pendingGraceNote = false;
      }

      // Bass drone: two stacked roots (octave down + two down) held for the
      // pattern cycle, like the two whole notes in a pop piano score.
      if (idx === 0 && pattern.bassDrone && chord.length > 0) {
        const cycleSec = pattern.steps.length * barSec8th;
        const bass1 = notesForStep(chord, [-1], this.currentScale)[0];
        const bass2 = bass1 ? this.dropOctave(bass1) : null;
        const inst = this.instrument === "guitar" ? this.guitar : this.piano;
        for (const [note, vel] of [
          [bass1, 60] as const,
          [bass2, 70] as const,
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

        // attackChordNow() just sounded this chord off-grid; drop a grid hit
        // within a flam of it so a change a hair before the beat doesn't
        // double-strike.
        if (isFullChord && time - this.lastImmediateAttack < 0.09) {
          this.stepCounter++;
          return;
        }

        // Downbeats louder, off-beats softer, a little random.
        const onBeat = idx % 2 === 0;
        const isDownbeat = idx === 0 || idx === pattern.steps.length / 2;
        const baseVel = isFullChord ? 58 : 78;
        const beatBoost = isDownbeat ? 22 : onBeat ? 12 : -4;
        const jitter = (Math.random() - 0.5) * 10;
        const velocity = Math.max(28, Math.min(110, baseVel + beatBoost + jitter));
        // ±2 ms of timing drift: less robotic, still in the pocket.
        const noteTime = time + Math.random() * 0.002;

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
          // Long durations: the pedal + release samples give the decay, and
          // a chord change cuts them via releasePianoVoices().
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
    // Perform mode starts the Transport itself, on a scheduled downbeat.
    if (!this.gridLocked && Tone.getTransport().state !== "started") Tone.getTransport().start();
    this.loopRunning = true;
  }

  // Pause fades the master out: releasing voices leaves their release
  // envelopes and the room tail ringing for a second or two otherwise.
  private duck(on: boolean): void {
    const ctx = this.nativeCtx;
    if (!ctx || !this.master) return;
    const g = this.master.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 0 : MASTER_GAIN, t, on ? 0.02 : 0.01);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.duck(p);
    if (p) {
      this.releasePianoVoices();
      this.releaseGuitarVoices();
      this.pauseBackingTrack();
    } else if (this.backingBuffer && !this.backingPlaying && this.backingPausedAt > 0) {
      this.playBackingTrack();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  // ── Perform mode clock ────────────────────────────────────────────────

  /**
   * Start a timed run: the Transport restarts at 0 with a count-in, the
   * pattern grid locks to the song's bars, and songTime() reads the audible
   * position. Bar k of the song starts at countInBeats * beat + k * bar.
   */
  startPerformance(opts: { bpm: number; countInBeats: number; metronome: boolean }): void {
    const ctx = this.ensureContext();
    const transport = Tone.getTransport();
    this.stopLoop();
    transport.cancel(0);
    transport.bpm.value = opts.bpm;
    transport.position = 0;
    const beat = 60 / opts.bpm;
    this.gridLocked = true;
    this.stepOffset = opts.countInBeats * 2;
    this.stepCounter = 0;
    this.paused = false;
    for (let i = 0; i < opts.countInBeats; i++) {
      transport.scheduleOnce((t) => this.click(t, i === 0 ? 2 : 1), i * beat);
    }
    if (opts.metronome) {
      transport.scheduleRepeat(
        (t) => {
          const b = Math.round(transport.getSecondsAtTime(t) / beat) - opts.countInBeats;
          this.click(t, b % 4 === 0 ? 1 : 0);
        },
        beat,
        opts.countInBeats * beat,
      );
    }
    this.startLoop();
    // A little lookahead so the first count-in click isn't clipped.
    transport.start(ctx.currentTime + 0.12);
  }

  /** Audible Transport position in seconds (0 before start). */
  songTime(): number {
    const ctx = this.nativeCtx;
    if (!ctx) return 0;
    const transport = Tone.getTransport();
    if (transport.state === "stopped") return 0;
    return Math.max(0, transport.getSecondsAtTime(ctx.currentTime));
  }

  /** Convert an AudioContext timestamp to song time (for input onsets). */
  songTimeAt(ctxTime: number): number {
    const transport = Tone.getTransport();
    if (transport.state === "stopped") return 0;
    return Math.max(0, transport.getSecondsAtTime(ctxTime));
  }

  now(): number {
    return this.nativeCtx?.currentTime ?? 0;
  }

  pausePerformance(): void {
    // attackChordNow() is gated on `paused`, so hands/keys stay silent under
    // the pause overlay while the Transport is frozen.
    this.paused = true;
    this.duck(true);
    Tone.getTransport().pause();
    this.releasePianoVoices();
    this.releaseGuitarVoices();
    this.pauseBackingTrack();
  }

  resumePerformance(): void {
    const ctx = this.nativeCtx;
    if (!ctx) return;
    this.paused = false;
    this.duck(false);
    Tone.getTransport().start(ctx.currentTime + 0.05);
    if (this.backingBuffer && !this.backingPlaying) this.playBackingTrack();
  }

  stopPerformance(): void {
    this.paused = false;
    this.duck(false);
    const transport = Tone.getTransport();
    transport.cancel(0);
    this.stopLoop();
    this.gridLocked = false;
    this.stepOffset = 0;
  }

  // Woodblock-ish count-in click: a short pitched blip with a fast drop.
  // accent 2 = first count-in beat, 1 = downbeat, 0 = other beats.
  private click(time: number, accent: 0 | 1 | 2): void {
    const ctx = this.nativeCtx;
    if (!ctx || !this.clickGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = accent === 2 ? 1760 : accent === 1 ? 1320 : 990;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, time);
    osc.frequency.exponentialRampToValueAtTime(f * 0.55, time + 0.05);
    const peak = accent === 0 ? 0.28 : 0.45;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
    osc.connect(g);
    g.connect(this.clickGain);
    osc.start(time);
    osc.stop(time + 0.09);
  }

  /** Soft two-note bell straight from oscillators: plays the instant the
   *  user taps Start (no samples needed), so a silent phone is obvious. */
  chime(): void {
    const ctx = this.nativeCtx;
    if (!ctx || !this.bus || !this.reverbIn) return;
    const t0 = ctx.currentTime + 0.02;
    [659.25, 987.77].forEach((freq, i) => {
      const t = t0 + i * 0.11;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      for (const [mult, amp] of [[1, 1], [2.76, 0.18], [5.4, 0.06]] as const) {
        const osc = ctx.createOscillator();
        const og = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        og.gain.value = amp;
        osc.connect(og);
        og.connect(g);
        osc.start(t);
        osc.stop(t + 1.7);
      }
      g.connect(this.bus!);
      g.connect(this.reverbIn!);
    });
  }

  // Filler: 4 eighth-note tokens resolved against the SONG TONIC (not the
  // next chord), so a fill stays in key. "random" picks a concrete filler
  // each time and skips 25% of bars so fills don't land on every change.
  // The selected instrument and its voice list (fills, grace notes).
  private currentVoice(): { inst: SmplrAnyPiano | SmplrSoundfont | null; stops: Array<() => void> } {
    return this.instrument === "guitar"
      ? { inst: this.guitar, stops: this.activeGuitarStops }
      : { inst: this.piano, stops: this.activePianoStops };
  }

  private triggerFiller(time: number, barSec8th: number): void {
    const { inst, stops } = this.currentVoice();
    if (!inst || this.currentScale.length !== 7) return;

    let filler: FillerPattern = this.currentFiller;
    if (filler.id === "random") {
      if (Math.random() < 0.25) return;
      const pool = FILLERS.filter((f) => f.id !== "random");
      filler = pool[Math.floor(Math.random() * pool.length)];
    }

    // A virtual tonic chord as the basis for the scale walker: token 1 =
    // tonic, 8 = tonic up an octave, and so on.
    const tonicPc = this.currentScale[0];
    const tonicBase = [`${tonicPc}4`];
    const tonicMidi = Note.midi(`${tonicPc}4`);

    for (let i = 0; i < filler.steps.length; i++) {
      const token = filler.steps[i];
      let note: string | null = null;

      if (typeof token === "string") {
        // Tensions are relative to the tonic: a fixed colour note in the key.
        const semis = TENSION_SEMITONES[token];
        if (semis != null && tonicMidi != null) note = Note.fromMidi(tonicMidi + semis);
      } else if (token === 0) {
        continue;
      } else {
        const resolved = notesForStep(tonicBase, [token], this.currentScale);
        note = resolved[0] ?? null;
      }

      if (!note) continue;
      const stop = inst.start({
        note,
        time: time + i * barSec8th,
        velocity: 52,
        duration: barSec8th * 1.4,
      });
      if (stop) stops.push(stop as () => void);
    }
  }

  // A quick high root on the new chord's first beat, to propel the change.
  private triggerGraceNote(time: number, chord: string[]): void {
    const { inst, stops } = this.currentVoice();
    if (!inst) return;
    const rootPc = chord[0]?.replace(/\d+$/, "");
    if (!rootPc) return;
    // Guitar's range tops out lower; an octave-5 root still reads as a grace.
    const octave = this.instrument === "guitar" ? 5 : 6;
    const stop = inst.start({ note: `${rootPc}${octave}`, time, velocity: 55, duration: 0.6 });
    if (stop) stops.push(stop as () => void);
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
    if (Tone.getTransport().state !== "stopped") Tone.getTransport().stop();
    this.loopRunning = false;
    this.stepCounter = 0;
    this.releasePianoVoices();
    this.releaseGuitarVoices();
  }

  getStepIndex(): number {
    if (!this.currentPattern) return -1;
    return this.patternStep(this.currentPattern.steps.length);
  }

  // ── Drone: a soft low tonic pad while no hands are up ─────────────────

  startDrone(rootNote: string): void {
    const ctx = this.nativeCtx;
    if (!ctx || !this.droneGain) return;
    const tonic = rootNote.replace(/\d+$/, "");
    if (this.droneVoices.length && this.droneKey === tonic) return;
    this.stopDrone();
    const t = ctx.currentTime;
    for (const oct of [2, 3]) {
      const freq = Note.freq(`${tonic}${oct}`);
      if (!freq) continue;
      for (const detune of [-4, 4]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(oct === 2 ? 0.045 : 0.03, t + 2);
        osc.connect(gain);
        gain.connect(this.droneGain);
        osc.start(t);
        this.droneVoices.push({ osc, gain });
      }
    }
    this.droneKey = tonic;
  }

  stopDrone(): void {
    const ctx = this.nativeCtx;
    if (!ctx || !this.droneVoices.length) return;
    const t = ctx.currentTime;
    for (const { osc, gain } of this.droneVoices) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      osc.stop(t + 2.6);
    }
    this.droneVoices = [];
    this.droneKey = "";
  }

  /** 0..1 loudness of the master output, for visuals. */
  getLevel(): number {
    const a = this.analyser;
    const buf = this.analyserBuf;
    if (!a || !buf) return 0;
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    return Math.min(1, rms * 4);
  }

  // ── Backing track (drum + bass + pad stem) ─────────────────────────────

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
    if (!this.backingBuffer || !this.backingGain || this.backingPlaying) return;
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
    this.backingPausedAt = elapsed % (this.backingBuffer?.duration ?? 1);
    try { this.backingSource.stop(); } catch {}
    this.backingSource.disconnect();
    this.backingSource = null;
    this.backingPlaying = false;
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
