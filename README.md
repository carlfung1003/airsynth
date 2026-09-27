# AirSynth

A music game you play with your hands. Right hand points at a chord on a ring, left hand makes a shape to pick how the chord plays, and the setlist gives you time-synced lyrics (LRClib) to sing along to. Everything also works by tap and keyboard.

Live: [airsynth.carlfung.dev](https://airsynth.carlfung.dev)

## v3 (KAN-226): the game

- **Screens**: title, setlist, play, results. The Start tap on the title is also the audio unlock (see below).
- **Perform mode**: the song runs at tempo after a one-bar count-in. Every chord entry is one bar (the encoder convention), so each bar has a target downbeat on the song clock. Changing to the right chord within ±130 ms is Perfect, ±260 ms Great, ±420 ms Good (earlier than that still counts as Good once held), otherwise Miss. Repeated bars just need you to keep holding. Streak multiplier x1 to x4, accuracy, grade S to D, local bests per song. Speed 70 / 85 / 100% and a "to first chorus" length for quick runs. Hand-tracked input is backdated 100 ms for camera latency.
- **Practice mode**: the old song mode. The song waits for you, with section loop, speed, transpose and section jumps.
- **Free play**: seven diatonic chords in any key, presets and custom key.
- **Chord lane**: bars slide toward a hit line (one rAF writes a transform, no React renders per frame); repeats join the bar before them; judged bars keep their grade colour.
- Game logic is pure and tested: `lib/game.ts`, `npx tsx tests/game.test.ts`.

### v3.1 (KAN-229)

- **Drums**: an LM-2 (LinnDrum) kit from smplr, scheduled off Transport ticks so it stays on the bar line. Grooves in `lib/grooves.ts` (ballad, half-time, pop, drive), set per song with `groove` or picked from tempo. Perform counts in on sticks and hits a crash on each new section; practice and free play drum while a chord is held. The kit loads in the background and a run never waits for it.
- **Early / Late**: a change outside the Perfect window says which way it missed. Results add a timing sentence ("On average 48 ms late") and a strip with one tick per bar, coloured by grade.
- **Input offset**: players change on what they hear, which arrives late by the device's output latency (Bluetooth: 150 to 250 ms). Onsets are shifted back by the browser-reported latency, or by a calibrated value (Sound settings, Timing, Calibrate: tap along with 12 clicks, median of the last 8).
- **Warm-up**: a guided 10-bar song first in the setlist. Songs with `coach` lines show them in place of lyrics, keyed to the bar being played.
- **Feedback**: the judged chord badge flashes a ring (red for Perfect); streaks of 10, 25, 50 and 100 are called out in the reel hub.

### Mobile audio fixes

Sound did not work on phones. Four causes, all in `lib/audio.ts`:

1. **Audio started outside a gesture.** The camera path created the AudioContext after awaiting MediaPipe and `getUserMedia`, and iOS leaves a context made there suspended (its `resume()` promise never settles, so the app sat on "Loading piano samples" forever). Now `unlock()` runs synchronously inside the Start tap: create/resume the context, start a one-sample silent buffer.
2. **The ringer switch.** iOS mutes Web Audio on silent unless the page claims the playback audio session: `navigator.audioSession.type = "playback"` (iOS 17+), or a looping silent `<audio>` element on older iOS.
3. **No recovery after interruptions.** Calls, Siri and app switches leave the context "interrupted". Any later tap (touchend / click / keydown / pointerup, the events WebKit accepts) resumes it, and the red tally lamp in the top bar goes dark when a tap is needed.
4. **One failure wedged the engine.** smplr's AudioWorklet reverb could reject `addModule()` and the cached rejected promise killed audio for the session. The reverb is now a native ConvolverNode with a generated impulse response; loads have a timeout and can be retried from the lamp.

Also: smplr's `Reverb.getParam()` returns `preDelay` for every name, so the old wet/dry settings never landed. The new signal path is instruments, reverb send, glue compressor, limiter, master, with a native analyser for the visuals. The guitar loads on demand instead of at startup (less to download and decode on a phone).

### Art

Plates are generated with Nano Banana Pro on Vertex AI (`~/scripts/gcp-media/gemini-image.sh`) from one style brief ("a late-night recording session": 35mm, low-key tungsten light, one note of red), QA'd by eye, and processed by `scripts/process-art.mjs` into `public/art/`. Prompts, attempts and rejections are in `assets/art/art_manifest.json`; WebP masters in `assets/art/masters/` (raw PNGs are gitignored). Bump `ART_VERSION` in `lib/art.ts` when a plate changes.

### Checks

```bash
npx tsx tests/game.test.ts                                   # judging, scoring, charts
PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright \
  npx tsx tests/e2e-perform.ts http://localhost:3000         # plays a Perform run, expects S
  npx tsx tests/e2e-perform.ts --sloppy                      # late + skipped changes
  npx tsx tests/e2e-mobile-audio.ts                          # iPhone WebKit: unlock, load, sound
  npx tsx tests/e2e-recovery.ts                              # retry after a failed load, silent pause
  npx tsx tests/e2e-calibrate.ts                             # tap-along calibration lands near +100 ms
```

## Earlier versions

### Practice mode & two-hand commands

- **Tempo slider** (50%–150%) scales the song's authored BPM and any loaded backing track in lock-step — slow Marry You to 70% to learn the changes, then ramp back up
- **Transpose** (±6 semitones) shifts the active song's chord palette + engine root live so singers can drop a song into their vocal range without rewriting source data. The header readout shows the original key, the effective key, and the offset. Sharps stay sharps (F# / C# / G#) for chord-chart consistency. Resets to 0 on song change.
- **Section navigation** — the chord ribbon's top row shows every section in the song's structure as a clickable chip (verse · bridge · chorus · break …). Click to jump the cursor. The current section is highlighted amber. Pairs with the two-hand 👍👍 / ☝️☝️ commands for the same job.
- **Chord diagrams** — pop up below the chord ribbon whenever a chord is held.
  - **Piano mode** — universal mini-keyboard with chord-tone pitch classes lit cyan and the root highlighted amber. Derives directly from the resolved voicing, so it works for diatonic chords, 7ths, slash chords, and extended chords (♭9, ♯11, etc.).
  - **Guitar mode** — open-position fretboard with a barre rectangle, finger dots, and open/muted indicators. Hardcoded shapes cover the standard pop chord vocabulary plus the slash chords used by the shipped songs; any symbol outside the table falls back to the piano diagram.
- **Section loop** keeps the cursor inside the current section instead of advancing to the next — run a chorus until the chord shapes are automatic
- **Two-hand commands** (hold ~200ms with both hands in the same shape):
  - ✊ ✊ both fists → toggle pause
  - 👍 👍 both thumbs → jump to next section
  - ☝️ ☝️ both index fingers → jump to previous section
  - A bottom-center progress bar fills while the gesture is held; single-hand pattern selection is suppressed during the hold so a stray pattern doesn't switch
- **Backing track** — drop a drums+bass+pad stem at `/public/backing-tracks/<song-id>.mp3` and set `backingTrack: { url, sourceBpm }` on the `Song` entry. The engine stretches the buffer with `playbackRate` so it stays glued to the live chord loop even when you change tempo. A "Band" volume slider appears in the header whenever the active song has one.

### v2

### Song mode
- 8 pop songs encoded as phrase-aligned chord arrays — each LRC lyric line maps 1:1 to a phrase, so chord markers land on the right words instead of being spread evenly across the bar
- LRClib lyric ribbon with chord names floating above the lyrics (UG-style)
- Each song carries its own root key, BPM, default instrument, default pattern, and chart-source attribution back to Ultimate Guitar
- Right-hand reel automatically swaps from the 7 diatonic chords to the song's actual palette (e.g. Someone Like You shows A · E · F♯m · D · C♯m, in first-appearance order)
- Phrase format supports per-word chord placement (`{ chords: [...], at: [1, 5, 6, 8] }`) for songs where the change lands on a specific syllable

**Songs shipped:**

| Song | Artist | Key | BPM | Default |
|---|---|---|---|---|
| Love Yourself | Justin Bieber | C | 100 | guitar · pluck |
| Sorry | Justin Bieber | C | 100 | piano · block |
| Count on Me | Bruno Mars | C | 92 | guitar · travis |
| Just the Way You Are | Bruno Mars | D | 109 | piano · alberti |
| Marry You | Bruno Mars | D | 145 | piano · stride |
| Perfect | Ed Sheeran | G | 95 | guitar · pluck |
| Someone Like You | Adele | A | 135 | piano · alberti |
| Let It Be | The Beatles | C | 73 | piano · stride |

Plus a K-Ballad Lick study song demonstrating altered tension tokens.

### Audio engine
- **smplr SplendidGrandPiano** as the default piano — Steinway D, 4 velocity layers — replacing the old synth
- **10 piano flavors** picker: Grand, Kawai, Steinway B (1895), Upright Knight, Upright Yamaha, Bright, Honky-Tonk, Rhodes, Wurlitzer, CP80 (sources: smplr SplendidGrandPiano + Versilian VCSL + smplr ElectricPiano + Soundfont)
- **Real sampled acoustic guitar** instead of PluckSynth
- **Plate reverb** (smplr Dattorro implementation) wired in **parallel dry/wet routing** — at 0% reverb the dry signal bypasses the processor entirely, so it doesn't get colored by the input filter / allpass network (fixes the "hollow" feel)
- **Sustain pedal (CC64)** on chord changes for natural ring-out
- **Dual AudioContext** — Tone.js keeps its own (standardized-audio-context wrapper); smplr gets a fresh native `AudioContext` so its `AudioWorkletNode` typecheck passes

### Pattern library (16 piano + 8 guitar)

Patterns describe what each 8th note plays. Tokens are **scale steps from the chord root** when a scale is set (always true in song mode), so the same pattern adapts naturally to every chord without manual transposition.

**Piano patterns:**
- **Stride** — `(1 3) · 5↓ · (1 3) · 5↓` — pop comping with walking bass
- **Block** — anthem stabs on beats 1 & 3
- **Arpeggio** — `1 3 5 3 · 1 3 5 3` — pop ballad
- **Alberti** — `1 5 3 5` — classical broken chord
- **Slow Stride** — ballad half-speed stride
- **Wave** — `1 5 1↑ 2↑ 3↑ 2↑ 1↑ 5` — Yiruma / OST scale wave
- **Down Arp** — `1↑ 5 3 1` — cinematic outro
- **Roll** — `1 3 5 1↑ 5 3 1 5` — Adele-style descending wave
- **Folk** — `5↓ 3 5 3` — Ed Sheeran singer-songwriter pick
- **Lift** — `1 3 5 1↑ 3↑ 1↑ 5 3` — Coldplay-style bloom
- **Stairs** — `1 2 3 5 3 2 1 5` — scale-steps music-box feel
- **Pop** — `chord · chord · chord · chord` — 4-on-the-floor stabs
- **R&B** — syncopated off-beat chord stabs + walking bass
- **Hold** — whole-note chord, simplest singalong
- **Half Push** — two chord hits with soft pickup grace notes
- **Float** — `1↑ 5 1↑ 3 1↑ 5 1↑ 3` — 80s octave-pulse wash

**Guitar patterns:**
- Strum, Stab, Travis, Pluck, Classical, Country, Alt Bass, Falling

**bassDrone** — most patterns have an octave-doubled low root (both `-1` and `-2` octaves below the chord root) held for the full bar, so a sustained low bass anchors the rhythmic figure on top.

### Right-hand fillers (10 + Random)

A fill plays the last 4 eighth-notes of each bar to add motion. All resolve relative to the **tonic of the key**, not the next chord — feels in-key rather than mechanical.

| Filler | Notes | Style |
|---|---|---|
| Stepwise Down | `3↑ 2↑ 1↑ 5` | classic descending |
| Skip Down | `2↑ 3↑ 1↑ 5` | rises then drops · pop |
| Wide Leap | `1↑ 7 5 2` | falling-fifth · cinematic |
| Walk Up | `5 7 1↑ 3↑` | stepwise ascent · pop bridge |
| Anthem | `3↑ 5↑ 1↑ 5` | chord arp · big room |
| Anticipation | `— — 7 1↑` | quiet two-8th pickup |
| High Sparkle | `5↑ 3↑ 2↑ 1↑` | pure descent · top-line shimmer |
| Blue Tail | `1↑ 6 5 3` | bluesy descent through 6th |
| K-Ballad | `♭9 1↑ ♯11 5↑` | Korean ballad · altered emotion tones |
| K-Soft | `9 1↑ 13 5` | softer Korean tail · 9th + 13th |
| Random | 🎲 | picks a different fill per bar · 25% skip · human feel |

Tension tokens (`♭9`, `9`, `♯11`, `13`) resolve via Tonal.js against the active chord, not just the scale.

### Theory engine fixes
- **Scale-walking tokens** (`1..14`) — tokens map to scale steps from the chord root, so the same pattern phrase gives the right notes in C, D, G, A, etc. without rewriting
- **`expandScale` octave tracking** — walks the scale continuously and bumps the octave when the next note's MIDI falls below the previous, fixing wrong notes in any key whose tonic isn't C
- **Root-clamping for chord voicings** — `pickStartOctaveForRoot` clamps the root to MIDI 55–67 so high tonics (A, B) drop to octave 3, keeping chord clusters in the singable middle register
- **Slash & extension chord resolver** — handles `A/G♯`, `F♯m/C♯`, `E9`, `Cmaj7`, `Dsus4` etc. via Tonal; bass note in slash chords is preserved as the lowest voice
- **Grace notes** on chord changes for natural voice-leading
- **Auto walk-up** when the next chord is a step away

### UI
- Piano flavor chips (visible when piano is selected)
- Filler chips row (visible when fills are enabled and a song is loaded)
- Reverb slider (0–100%)
- Fills on/off toggle
- 2-column pattern grid (16 patterns no longer overflow)
- Keyboard shortcuts extended to 16 patterns: `q w e r t y u i o p a s d f g h`

## Adding songs (Claude Code skill)

A project-scoped Claude Code skill at `.claude/skills/airsynth-song-encoder/SKILL.md` turns a UG chord chart into a `Song` entry in `lib/songs.ts`. When you open this repo in Claude Code the skill is auto-loaded.

**To encode a song:**

1. Find the chart on Ultimate Guitar — Cloudflare blocks server-side fetching, so paste **screenshots of the printable-tab view** (3–6 usually covers a pop song)
2. In Claude Code: drop the screenshots and say `use the airsynth-song-encoder skill — here's <song title>, key <K>, BPM <N>`
3. The skill produces a new `Song` entry with:
   - Phrase-aligned chords (1 phrase per LRC lyric line)
   - Diatonic degree mapping (slash chords like `A/G♯` → `iii`, with comments explaining substitutions)
   - Default pattern picked to suit the song's feel (ballad → `alberti`/`pluck`, anthem → `stride`/`block`)
   - `chartUrl` linking back to the UG tab and `chartSource: "Ultimate Guitar"` for attribution
4. Verify with `npx tsc --noEmit && npm run lint`
5. Refresh `localhost:3000`, pick the new song, and spot-check that chord changes land on the right lyric words

The skill codifies the phrase format, degree mapping, slash-chord substitution rules, density check (chord positions ≈ LRC line count × 1.5), and the don'ts (no lyrics in source — they're fetched from LRClib at runtime, and they're copyrighted).

## How it works

**Hand tracking** — MediaPipe `HandLandmarker` runs in the browser, publishes per-frame `{ left, right, timestamp }` to the stage component.

**Right hand** — index finger angle around its base picks a chord on the radial reel. In free-play, the reel shows the 7 diatonic chords for the active key. In song mode, it shows the song's actual palette.

**Left hand** — gesture (fist, peace, thumb, rock, etc.) selects one of the 16 piano / 8 guitar patterns. Tap a pattern chip or use the keyboard shortcut to override.

**Scheduler** — `Tone.Transport` runs at the song's BPM. Each bar fires the pattern's step list as 8th notes. The current chord is voiced once per bar; subsequent steps reuse the voicing. Fills swap the last 4 steps when enabled.

**Lyrics** — fetched from LRClib by `{title, artist}` lookup, parsed into timed lines, and each line is aligned 1:1 with a song phrase via `phraseStartPositions`. Chord markers float above the words at the positions declared in the phrase.

## Getting started

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000), grant camera permission, click **Enable Hand Tracking** to start the audio context.

## Stack

- **Next.js 16** + Turbopack + Tailwind 4
- **Tone.js** — Transport, scheduling, guitar synth fallback
- **smplr** — SplendidGrandPiano, Versilian VCSL, ElectricPiano, Soundfont, Reverb
- **Tonal.js** — `Chord.get`, `Note.midi`, `Scale.get` for chord resolution and voicing
- **MediaPipe `HandLandmarker`** — in-browser hand tracking
- **LRClib API** — free time-synced lyrics (no auth required)

## Credits

Chord charts donated by the Ultimate Guitar community — each song carries a `chartUrl` link back to its source. Lyrics from [LRClib](https://lrclib.net). Piano samples from Steinway D (SplendidGrandPiano), Versilian Studios VCSL, and the free Soundfont collection bundled with smplr.
