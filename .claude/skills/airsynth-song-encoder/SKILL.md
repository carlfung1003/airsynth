---
name: airsynth-song-encoder
description: Transcribe Ultimate Guitar (or equivalent) chord charts into AirSynth song-mode data. Trigger whenever the user pastes UG/chord-chart screenshots in the airsynth project, says "add a song to AirSynth", "encode this song", "make this playable in song mode", or names a song they want playable. Also trigger if they share a UG/chordie/songsterr URL alongside a song name. Don't wait for an explicit "create a skill entry" — if the conversation is about getting a new song into AirSynth's song mode, this is the right tool.
---

# Format note (READ FIRST)

Songs use the **phrase-based** format: `SongSection.phrases: number[][]`. Each inner array = one LRC lyric line. The chord placement only stays accurate when phrases line up 1:1 with what LRClib returns. If you encode a flat `chords` array instead, the lyric mapper will fall back to time-weight distribution and drift across the song — that was the original "F#m D A" bug on Someone Like You's verse line 2. **Always use `phrases`.** The canonical example is `someone-like-you` in `lib/songs.ts`.

# AirSynth song encoder

Turns a Ultimate Guitar chord chart (usually pasted as 3-6 screenshots) into a `Song` entry in `~/airsynth/lib/songs.ts` so it plays in AirSynth's song mode. The canonical worked example is the `someone-like-you` entry in that file — read it first; it shows the format, the slash-chord substitution style, and how `chartUrl` / `chartSource` look.

## Inputs you'll receive

- A UG chart URL (preferred — fetch it via `claude-in-chrome` MCP, no Cloudflare fight)
- Or screenshots if the user doesn't have a URL handy
- Sometimes just a song title — in that case search UG and confirm the chart before encoding

## Pulling the chart from UG via Chrome MCP

The user has the Chrome MCP set up (`mcp__claude-in-chrome__*`). To get UG's exact chord layout:

1. `mcp__claude-in-chrome__tabs_context_mcp` with `createIfEmpty: true` to get a tab
2. `mcp__claude-in-chrome__navigate` to `https://tabs.ultimate-guitar.com/tab/print?id=<tab-id>` (the printable view — pulls the raw `<pre>` chord chart)
3. `mcp__claude-in-chrome__javascript_tool` with `document.querySelector('pre').innerText` to extract the full chord chart

The `<pre>` text gives character-aligned chord positions — chords appear on their own lines directly above the lyric line, with leading whitespace marking where in the line each chord falls. This is way more reliable than parsing screenshots.

## What success looks like

A new entry in the `SONGS` array of `lib/songs.ts` that:
- Maps every chord change in the chart to a diatonic degree
- Section order in `structure` matches how the recording actually unfolds (verse → bridge → chorus, etc.)
- Total chord-position count is roughly **LRC_line_count × 1.5** (so each lyric line has 1–3 chord markers when rendered)
- Has `chartUrl` linking back to the UG tab and `chartSource: "Ultimate Guitar"` for attribution
- Passes `npx tsc --noEmit` and `npm run lint` from `~/airsynth`

## Workflow

### 0. Pull LRClib lyrics first (sets the phrase count)

Before encoding chords, fetch the song's LRC and count lines per section. The chord data must have **one phrase per LRC line** — phrase count drives chord placement accuracy.

```bash
curl -s "https://lrclib.net/api/get?artist_name=<artist>&track_name=<title>" | python3 -c "
import json, sys, re
d = json.load(sys.stdin)
for line in (d.get('syncedLyrics') or '').split('\n'):
    m = re.match(r'\[(\d+):(\d+)\.(\d+)\](.*)', line)
    if m: print(f'{int(m.group(1))*60 + int(m.group(2)):6.1f}s  {m.group(4).strip()}')
"
```

Empty lines in the LRC (gaps with no text) usually mark section boundaries. Use that + each section's first lyric to identify which LRC lines belong to which section.

For each section, count the lines. That's the **exact number of phrases** that section needs in the song data.

### 1. Identify the song

Title, artist, **key**, **BPM**. Look up the key/BPM if the chart doesn't show it — most pop songs are on tunebat.com or the UG header line ("Key: A · Capo: No capo"). Don't guess BPM blindly; wrong BPM throws off the LRClib lyric stretch.

### 2. Read the chart sections

UG charts use `[Intro]`, `[Verse]`, `[Pre-Chorus]`, `[Chorus]`, `[Bridge]`, `[Break]`, `[Outro]` headers. Each section becomes one `SongSection` with `id` (lowercase, no spaces) and `label` (displayed in the chord ribbon).

The **structure** array is the section ID list in playback order. A typical pop song:

```ts
structure: ["verse", "bridge", "chorus", "verse", "bridge", "chorus", "break", "chorus"]
```

Repeat section IDs are fine — they reuse the same chord array but the cursor walks them as separate iterations.

### 3. Map chord symbols → diatonic degrees

Use the const aliases at the top of `lib/songs.ts`:

```ts
const I = 0, ii = 1, iii = 2, IV = 3, V = 4, vi = 5;
// vii° = 6 exists but is rarely useful in pop
```

**Diatonic mapping for any major key** (rootKey = scale degree 1):

| degree | quality | example (A major) |
|---|---|---|
| I  | major | A   |
| ii | minor | Bm  |
| iii| minor | C#m |
| IV | major | D   |
| V  | major | E   |
| vi | minor | F#m |

**Handling non-diatonic chords** — these are the ones that need judgment:

- **Slash chords** (`A/G#`, `E/D`, `F#m/C#`): drop the bass and use the *upper triad's* degree, OR if the bass note is a clear voice-leading move, pick the diatonic chord that contains that bass note. Worked example: `A → A/G# → F#m → D` in A major. The `A/G#` is a chromatic bass walk; map it to `iii` (C#m contains G#, bridges A → F#m the same way). This sounds natural; mapping it to `I` again would create three I's in a row and lose the motion.
- **Extension chords** (`E9`, `F#m7`, `Cmaj7`, `Dsus4`): drop the extension, use the root triad's degree. `E9` → `V`.
- **Borrowed chords** (`bVII` in major, modal mixture): pick the closest diatonic neighbor (`IV` or `V` usually) and **leave an inline comment** explaining the swap so it's verifiable later.
- **Secondary dominants** (`V/V`, `V/vi`): substitute their resolution chord's diatonic equivalent, or the closest plain V/IV neighbor. Comment the choice.

Always comment substitutions inline. Future-you (or someone else reviewing the data) needs to know which entries are exact and which are approximations.

### 4. Chord-position density

Each chord entry is one bar. Get the density right so LRC lyric mapping aligns:

- Read the chart line-by-line. A line with one chord above the start = 1 chord position for that line. A line with 4 chords spread across the words = 4 chord positions.
- Section total = sum of chord positions per line.
- Sanity check: roughly **LRC_line_count_in_section × avg_chords_per_line**.

For Someone Like You's chorus: 4 lyric lines × 4 chords each (`A E F#m D`) = 16 chord positions. For the same song's verse: 9 lines, chord cycle `A A/G# F#m D` × 3 = 12 positions.

If the chart shows a section but no chord change inside a 2-bar line, you can still encode 2 positions of the same degree — the bar-based auto-advance in song mode handles repeats.

### 5. Write the entry (phrase-based)

Append to the `SONGS` array in `~/airsynth/lib/songs.ts`. Use `phrases` (not `chords`) — each inner array maps to **exactly one LRC line**:

```ts
{
  id: "kebab-case-id",
  title: "Title Case",
  artist: "Artist Name",
  rootKey: "A",          // root note of the key
  scaleType: "major",
  bpm: 135,
  defaultInstrument: "piano",
  defaultPatternId: "alberti",
  sections: [
    {
      id: "verse",
      label: "Verse",
      phrases: [
        [I, iii],   // LRC line 0 — comment with the actual lyric for verification
        [vi, IV],   // LRC line 1
        // ...
      ],
    },
    // more sections
  ],
  structure: ["verse", "chorus", /* etc. */],
  chartUrl: "https://tabs.ultimate-guitar.com/tab/{artist}/{title}-chords-{id}",
  chartSource: "Ultimate Guitar",
},
```

**Phrase count must equal LRC line count** per section — that's the rule that keeps chord placement accurate. If LRC has more lines than UG shows phrases (e.g. UG combines verse lines while LRClib splits them), pad with repeats of the appropriate chord. If LRC has fewer (e.g. instrumental gaps), drop the silent positions.

Pick `defaultPatternId` to suit the song's feel — ballads use `alberti` or `pluck`, anthems use `stride` or `block`, fingerpick-y songs use `travis` or `pluck`.

### 6. Verify build

Run from `~/airsynth`:

```bash
npx tsc --noEmit && npm run lint
```

Lint should report only the pre-existing `HandTracker.tsx` issues and the `PATTERN_KEYS` exhaustive-deps warning. Anything new in your file is a real problem to fix before declaring done.

### 7. **Verify chord placement** (mandatory step)

Carl explicitly asked for this — chord placement was wrong on Someone Like You and made it sound off. Before declaring done:

1. Print a side-by-side mapping showing **what AirSynth will display** vs **what UG shows**, section by section.

   For each LRC line, show:
   ```
   LRC: <lyric text>
   AirSynth phrase: [I, iii]  → A, C#m (sub for A/G#)
   UG chord line:   A   A/G#
   ```

2. Highlight any phrase whose chord count or order doesn't match UG's chord layout for that line.

3. Ask the user to refresh `localhost:3000`, pick the song, walk through each section, and confirm:
   - Each lyric line shows the expected chord markers (no extras, no missing)
   - The chord at the start of each line matches what UG shows above the first word
   - Section transitions don't drop or repeat lines

If anything looks off, the fix is in the song's phrases — most commonly: a phrase is missing a continuation chord, or a slash-chord substitution was wrong.

## Common gotchas

- **Capo charts**: if the UG header says "Capo: 3rd fret" and shows the song in G shapes, the actual sounding key is Bb. Use the sounding key as `rootKey`, not the shape key. Most popular charts already use the sounding key for chord names.
- **Minor-key songs**: set `scaleType: "minor"`. Then degrees map differently (i, ii°, III, iv, v, VI, VII). The const aliases still work but the chord qualities change.
- **Songs that modulate**: pick the dominant key and accept some imperfection in the modulated section, OR split into two song entries (rare; usually not worth it).
- **Very long songs** (>5 min): the chord position count gets big. Don't over-pad — if it feels unwieldy, prune the structure to the essential sections (intro/outro often drop without much loss).
- **`vii°`**: real songs rarely use it. If you reach for it, double-check — usually a secondary dominant or substitution is more accurate.

## Optional: backing track

A song can declare a `backingTrack` field that points to a stem (drums + bass + ambient pad, no melody) hosted in `public/`. The audio engine loads it, time-stretches it to the song's BPM via `playbackRate`, and loops it under the chord input — turns the chord trainer into a play-along band.

```ts
backingTrack: {
  url: "/backing/love-yourself.mp3",
  sourceBpm: 100,   // BPM the stem was recorded at
}
```

How to generate one (Suno workflow):
1. In Suno (or any DAW), make a 30–60s loop matching the song's BPM and key. Drums + bass + ambient pad. No melody, no vocals — those would clash with the user's chord playing.
2. Render to MP3, save to `~/airsynth/public/backing/<song-id>.mp3`.
3. Add the `backingTrack` field. Done.

## Don't

- Don't put lyrics in the source — they're fetched from LRClib at runtime, and they're copyrighted.
- Don't try to fetch UG over the network (Cloudflare blocks server-side; that's why we work from screenshots).
- Don't skip the `chartUrl`/`chartSource` fields — community charts are donated work, crediting them is the right thing.
- Don't over-engineer `beats` — the engine defaults to one bar per chord, which matches how UG charts work. Only set `beats` if a chord deliberately holds for half-bar or two-bar lengths and that's audible in the recording.
