# Backing Tracks

Drop song-id-named MP3s here (e.g. `love-yourself.mp3`) to enable the
backing-track feature in AirSynth song mode.

Each track should be:
- A short loop (30–60s) of **drums + bass + ambient pad only** — no melody, no vocals
- Recorded at a known BPM (declare in `Song.backingTrack.sourceBpm`)
- In the song's actual key
- MP3 / m4a / ogg — anything `decodeAudioData` supports

The audio engine loops it at the right playback rate so it matches the
song's BPM. Users play chords on top — feels like jamming with a band.

Suggested source: Suno custom-generation with a prompt like
"instrumental backing track, drums and bass and ambient pad, key of A
major, 135 BPM, no melody, no vocals, simple groove for a chord
trainer".
