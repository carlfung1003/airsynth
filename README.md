# AirSynth

Gesture-driven piano & guitar for singing along. Right hand points at a chord on a radial reel; left hand makes a shape to pick how the chord plays. Songs come with their own chord palette and time-synced lyrics from LRClib so you can follow along.

Live: [airsynth.carlfung.dev](https://airsynth.carlfung.dev)

## Practice mode & two-hand commands

- **Tempo slider** (50%–150%) scales the song's authored BPM and any loaded backing track in lock-step — slow Marry You to 70% to learn the changes, then ramp back up
- **Section loop** keeps the cursor inside the current section instead of advancing to the next — run a chorus until the chord shapes are automatic
- **Two-hand commands** (hold ~200ms with both hands in the same shape):
  - ✊ ✊ both fists → toggle pause
  - 👍 👍 both thumbs → jump to next section
  - ☝️ ☝️ both index fingers → jump to previous section
  - A bottom-center progress bar fills while the gesture is held; single-hand pattern selection is suppressed during the hold so a stray pattern doesn't switch
- **Backing track** — drop a drums+bass+pad stem at `/public/backing-tracks/<song-id>.mp3` and set `backingTrack: { url, sourceBpm }` on the `Song` entry. The engine stretches the buffer with `playbackRate` so it stays glued to the live chord loop even when you change tempo. A "Band" volume slider appears in the header whenever the active song has one.

## What's new in this version

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
