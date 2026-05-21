import type { ChordStyle, Instrument, ScaleType } from "./theory";

// A phrase = one LRC lyric line. Either a flat array of chord symbols
// (positions auto-distributed across the words evenly) or an object with
// explicit word indices for precise UG-style alignment.
//
//   ["A", "E", "F#m", "D"]
//     → chord markers evenly spread across the line
//   { chords: ["A", "E", "F#m", "D"], at: [1, 5, 6, 8] }
//     → A on word 1, E on word 5, F#m on word 6, D on word 8 (0-indexed)
export type Phrase = string[] | { chords: string[]; at?: number[] };

export function phraseChords(p: Phrase): string[] {
  return Array.isArray(p) ? p : p.chords;
}

export function phraseAt(p: Phrase): number[] | undefined {
  return Array.isArray(p) ? undefined : p.at;
}

export type SongSection = {
  id: string;
  label: string;
  phrases: Phrase[];
};

export function sectionChordSymbols(section: SongSection): string[] {
  return section.phrases.flatMap(phraseChords);
}

// Unique chord symbols across the song, in first-appearance order. This is
// the right-hand reel when a song is loaded — instead of the diatonic seven,
// the user navigates the chords actually used in this song.
export function getSongPalette(song: Song): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const sec of song.sections) {
    for (const phrase of sec.phrases) {
      for (const c of phraseChords(phrase)) {
        if (!seen.has(c)) {
          seen.add(c);
          order.push(c);
        }
      }
    }
  }
  return order;
}

// Returns, for each LRC phrase in the song, the global chord position where
// that phrase begins. Used to align lyrics 1:1 with chord positions.
export function phraseStartPositions(song: Song): number[] {
  const starts: number[] = [];
  let pos = 0;
  for (const secId of song.structure) {
    const sec = song.sections.find((s) => s.id === secId);
    if (!sec) continue;
    for (const phrase of sec.phrases) {
      starts.push(pos);
      pos += phraseChords(phrase).length;
    }
  }
  return starts;
}

// For a given lyric line (LRC phrase index in the active section), return
// the explicit word-index positions if the phrase declares them. Used by
// the renderer to skip even-distribution and use UG-accurate placement.
export function phraseWordPositions(song: Song, structureIdx: number, phraseIdx: number): number[] | undefined {
  const sec = song.sections.find((s) => s.id === song.structure[structureIdx]);
  if (!sec) return undefined;
  const phrase = sec.phrases[phraseIdx];
  return phrase ? phraseAt(phrase) : undefined;
}

export type Song = {
  id: string;
  title: string;
  artist: string;
  rootKey: string;
  scaleType: ScaleType;
  chordStyle?: ChordStyle;
  bpm?: number;
  defaultPatternId?: string;
  defaultInstrument?: Instrument;
  sections: SongSection[];
  structure: string[];
  chartUrl?: string;
  chartSource?: string;
  // Optional backing track — drums + bass + pad stem the user plays chords
  // over. Path is relative to /public, sourceBpm is the recorded tempo so
  // the engine can match it to the song's BPM via playbackRate.
  backingTrack?: { url: string; sourceBpm: number };
};

export const SONGS: Song[] = [
  {
    id: "love-yourself",
    title: "Love Yourself",
    artist: "Justin Bieber",
    rootKey: "C",
    scaleType: "major",
    bpm: 100,
    defaultInstrument: "guitar",
    defaultPatternId: "pluck",
    sections: [
      {
        id: "verse",
        label: "Verse",
        // UG verse alternates C G/B Am / Dm C G/B with chord letters
        // landing on specific syllables. Mapped to LRClib's 10 verse lines.
        phrases: [
          // "For all the times that you rained on my parade"
          // C over "For all", G/B over "rain", Am over "parade"
          { chords: ["C", "G/B", "Am"], at: [0, 5, 9] },
          // "And all the clubs you get in using my name"
          { chords: ["Dm", "C", "G/B"], at: [0, 4, 9] },
          // "You think you broke my heart, oh, girl, for goodness' sake"
          { chords: ["C", "G/B", "Am"], at: [0, 5, 9] },
          // "You think I'm crying on my own, well, I ain't"
          { chords: ["Dm", "C", "G/B"], at: [0, 3, 8] },
          // "And I didn't wanna write a song"
          { chords: ["C", "G/B"], at: [0, 5] },
          // "'Cause I didn't want anyone thinkin' I still care, I don't, but"
          { chords: ["Am", "Dm"], at: [0, 8] },
          // "You still hit my phone up"
          { chords: ["C", "G/B"], at: [0, 3] },
          // "And baby, I'll be movin' on"
          { chords: ["C", "G/B"], at: [0, 4] },
          // "And I think you should be somethin' I don't wanna hold back"
          { chords: ["Am", "Dm", "C"], at: [0, 6, 9] },
          // "Maybe you should know that"
          { chords: ["G/B"], at: [0] },
        ],
      },
      {
        id: "prechorus",
        label: "Pre-Chorus",
        phrases: [
          // "My mama don't like you and she likes everyone"  [0..8]
          { chords: ["Am", "F", "C"], at: [0, 3, 7] },
          // "And I never like to admit that I was wrong"
          { chords: ["Am", "F", "C"], at: [0, 3, 8] },
          // "And I've been so caught up in my job"
          { chords: ["Am", "F"], at: [0, 5] },
          // "Didn't see what's going on, but now I know"
          { chords: ["C", "G", "Am", "F"], at: [0, 3, 6, 8] },
          // "I'm better sleeping on my own"
          { chords: ["G"], at: [0] },
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        phrases: [
          // "'Cause if you like the way you look that much"  [0..8]
          // UG: C over start, G over "the way", Am over "look", F over "much"
          { chords: ["C", "G", "Am", "F"], at: [0, 4, 7, 8] },
          // "Oh, baby, you should go and love yourself"
          // C over "Oh", F over "love", C over "yourself"
          { chords: ["C", "F", "C"], at: [0, 6, 7] },
          // "And if you think that I'm still holdin' on to somethin'"
          { chords: ["C", "G", "Am", "F"], at: [0, 4, 7, 10] },
          // "You should go and love yourself"
          { chords: ["C", "F", "C"], at: [0, 4, 5] },
        ],
      },
      {
        id: "bridge",
        label: "Bridge",
        // Final pre-chorus / verse-3 (lines 38-41 in LRC).
        phrases: [
          // "For all the times that you made me feel small"
          { chords: ["C", "G/B", "Am"], at: [0, 5, 9] },
          // "I fell in love, now I feel nothin' at all"
          { chords: ["Dm", "C", "G/B"], at: [0, 4, 8] },
          // "I never felt so low and I was vulnerable"
          { chords: ["C", "G/B", "Am"], at: [0, 5, 7] },
          // "Was I a fool to let you break down my walls?"
          { chords: ["Dm", "C", "G/B"], at: [0, 4, 8] },
        ],
      },
    ],
    structure: ["verse", "prechorus", "chorus", "verse", "prechorus", "chorus", "bridge", "chorus", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/justin-bieber/love-yourself-chords-1780199",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "sorry",
    title: "Sorry",
    artist: "Justin Bieber",
    // UG chart in C-major shapes with capo 3 (sounds in Eb). The reel will
    // show F/Am/G as on the chart.
    rootKey: "C",
    scaleType: "major",
    bpm: 100,
    defaultInstrument: "piano",
    defaultPatternId: "block",
    sections: [
      {
        id: "verse",
        label: "Verse",
        // UG: F Am G — each cycle spans one LRC line. F over start, Am
        // around mid-line, G near end (UG positions vary; rough word indices
        // tuned for typical 10-12 word LRC lines).
        phrases: [
          // "You gotta go and get angry at all of my honesty"  [0..10]
          { chords: ["F", "Am", "G"], at: [0, 4, 8] },
          // "You know I try but I don't do too well with apologies"
          { chords: ["F", "Am", "G"], at: [0, 4, 9] },
          // "I hope I don't run out of time, could someone call a referee?"
          { chords: ["F", "Am", "G"], at: [0, 5, 9] },
          // "Cause I just need one more shot at forgiveness"
          { chords: ["F", "Am", "G"], at: [0, 4, 7] },
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        phrases: [
          // "Yeah, is it too late now to say sorry?"  [0..7]
          { chords: ["F", "Am", "G"], at: [0, 4, 7] },
          // "Cause I'm missing more than just your body"
          { chords: ["F", "Am", "G"], at: [0, 4, 7] },
          // "Is it too late now to say sorry?"
          { chords: ["F", "Am", "G"], at: [0, 3, 6] },
          // "Yeah I know that I let you down"
          { chords: ["Dm"], at: [0] },
          // "Is it too late to say I'm sorry now?"
          { chords: ["F", "G"], at: [0, 5] },
        ],
      },
    ],
    structure: ["verse", "verse", "chorus", "chorus", "verse", "chorus", "chorus", "chorus", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/justin-bieber/sorry-chords-1775840",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "count-on-me",
    title: "Count on Me",
    artist: "Bruno Mars",
    rootKey: "C",
    scaleType: "major",
    bpm: 92,
    defaultInstrument: "guitar",
    defaultPatternId: "travis",
    sections: [
      {
        id: "intro",
        label: "Intro",
        phrases: [{ chords: ["C"], at: [0] }],
      },
      {
        id: "verse",
        label: "Verse",
        phrases: [
          // "If you ever find yourself stuck in the middle of the sea"
          { chords: ["C", "Em"], at: [0, 9] },
          // "I'll sail the world to find you"
          { chords: ["Am", "G", "F"], at: [0, 3, 5] },
          // "If you ever find yourself lost in the dark and you can't see"
          { chords: ["C", "Em"], at: [0, 9] },
          // "I'll be the light to guide you"
          { chords: ["Am", "G", "F"], at: [0, 3, 5] },
        ],
      },
      {
        id: "prechorus",
        label: "Pre-Chorus",
        phrases: [
          // "Find out what we're made of"
          { chords: ["Dm", "Em"], at: [0, 4] },
          // "When we are called to help our friends in need"
          { chords: ["F", "G"], at: [0, 4] },
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        phrases: [
          // "You can count on me like 1, 2, 3, I'll be there"
          { chords: ["C", "Em", "Am", "G"], at: [0, 3, 6, 10] },
          // "And I know when I need it"
          { chords: ["F"], at: [0] },
          // "I can count on you like 4, 3, 2, and you'll be there"
          { chords: ["C", "Em", "Am", "G"], at: [0, 3, 6, 10] },
          // "'Cause that's what friends are supposed to do, oh, yeah"
          { chords: ["F", "C"], at: [0, 9] },
          { chords: ["Em"], at: [0] },
          { chords: ["Am", "G"], at: [0, 1] },
          { chords: ["F", "G"], at: [0, 1] },
        ],
      },
      {
        id: "bridge",
        label: "Bridge",
        phrases: [
          // "You'll always have my shoulder when you cry"
          { chords: ["Dm", "Em", "Am", "G"], at: [0, 2, 4, 6] },
          // "I'll never let go, never say goodbye"
          { chords: ["Dm", "Em", "F", "G"], at: [0, 2, 4, 5] },
        ],
      },
    ],
    structure: ["intro", "verse", "prechorus", "chorus", "verse", "prechorus", "chorus", "bridge", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/bruno-mars/count-on-me-chords-949804",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "just-the-way-you-are",
    title: "Just the Way You Are",
    artist: "Bruno Mars",
    rootKey: "D",
    scaleType: "major",
    bpm: 109,
    defaultInstrument: "piano",
    defaultPatternId: "alberti",
    sections: [
      {
        id: "verse",
        label: "Verse",
        phrases: [
          { chords: ["D"], at: [0] },     // "Oh, her eyes, her eyes"
          { chords: ["D"], at: [0] },     // "Make the stars look like they're not shining"
          { chords: ["Bm7"], at: [0] },   // "Her hair, her hair"
          { chords: ["Bm7"], at: [0] },   // "Falls perfectly without her trying"
          { chords: ["G"], at: [0] },     // "She's so beautiful"
          { chords: ["D"], at: [0] },     // "And I tell her every day"
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        phrases: [
          { chords: ["D"], at: [0] },     // "When I see your face"
          { chords: ["Bm7"], at: [0] },   // "There's not a thing that I would change"
          { chords: ["G"], at: [0] },     // "'Cause you're amazing"
          { chords: ["D"], at: [0] },     // "Just the way you are"
        ],
      },
    ],
    structure: ["verse", "verse", "chorus", "chorus", "verse", "verse", "chorus", "chorus", "chorus", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/bruno-mars/just-the-way-you-are-chords-970416",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "marry-you",
    title: "Marry You",
    artist: "Bruno Mars",
    // UG chart in D shapes with capo 3 (sounds in F). This chart uses Em
    // (ii) where the Bruno Mars recording uses Bm (vi). Following UG.
    rootKey: "D",
    scaleType: "major",
    bpm: 145,
    defaultInstrument: "piano",
    defaultPatternId: "stride",
    sections: [
      {
        id: "chorus",
        label: "Chorus",
        // UG: D | Em | G D over 3 UG sub-lines per stanza. LRClib has 2 lines
        // per stanza: D-then-Em on the first, G-then-D on the second.
        phrases: [
          // "It's a beautiful night, we're looking for something dumb to do"
          { chords: ["D", "Em"], at: [0, 6] },
          // "Hey baby, I think I wanna marry you"
          { chords: ["G", "D"], at: [0, 4] },
          // "Is it the look in your eyes or is it this dancing juice?"
          { chords: ["D", "Em"], at: [0, 7] },
          // "Who cares, baby, I think I wanna marry you"
          { chords: ["G", "D"], at: [0, 5] },
          // "Just say I do"
          { chords: ["D"], at: [0] },
        ],
      },
      {
        id: "verse",
        label: "Verse",
        phrases: [
          // "Well, I know this little chapel on the boulevard we can go"
          { chords: ["D", "Em"], at: [0, 8] },
          // "No one will know, oh, come on girl"
          { chords: ["G", "D"], at: [0, 4] },
          // "Who cares if we're trashed, got a pocket full of cash we can blow"
          { chords: ["D", "Em"], at: [0, 8] },
          // "Shots of patron and it's on, girl"
          { chords: ["G", "D"], at: [0, 4] },
        ],
      },
      {
        id: "prechorus",
        label: "Pre-Chorus",
        phrases: [
          { chords: ["D"], at: [0] },   // "Don't say no, no, no, no, no"
          { chords: ["Em"], at: [0] },  // "Just say yeah, yeah, yeah, yeah, yeah"
          { chords: ["G"], at: [0] },   // "And we'll go, go, go, go, go"
          { chords: ["D"], at: [0] },   // "If you're ready, like I'm ready"
        ],
      },
      {
        id: "bridge",
        label: "Bridge",
        phrases: [
          { chords: ["D"], at: [0] },
          { chords: ["Em"], at: [0] },
          { chords: ["D"], at: [0] },
          { chords: ["Em"], at: [0] },
        ],
      },
    ],
    structure: ["chorus", "verse", "prechorus", "chorus", "verse", "prechorus", "chorus", "bridge", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/bruno-mars/marry-you-chords-1009718",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "perfect",
    title: "Perfect",
    artist: "Ed Sheeran",
    // UG chart in G shapes with capo 1 (sounds in Ab). Reel shows G-key chords.
    rootKey: "G",
    scaleType: "major",
    bpm: 95,
    defaultInstrument: "guitar",
    defaultPatternId: "pluck",
    sections: [
      {
        id: "verse",
        label: "Verse",
        phrases: [
          { chords: ["G"], at: [0] },              // "I found a love, for me"
          { chords: ["C", "D"], at: [0, 5] },      // "Darling, just dive right in and follow my lead"
          { chords: ["G", "Em"], at: [0, 3] },     // "Well, I found a girl, beautiful and sweet"
          { chords: ["C", "D"], at: [0, 6] },      // "Oh, I never knew you were the someone waiting for me"
        ],
      },
      {
        id: "prechorus",
        label: "Pre-Chorus",
        phrases: [
          { chords: ["G"], at: [0] },                          // "'Cause we were just kids when we fell in love"
          { chords: ["Em"], at: [0] },                         // "Not knowing what it was"
          { chords: ["C", "G", "D"], at: [0, 3, 5] },          // "I will not give you up this time"
          { chords: ["G"], at: [0] },                          // "But darling, just kiss me slow"
          { chords: ["Em"], at: [0] },                         // "Your heart is all I own"
          { chords: ["C", "D"], at: [0, 3] },                  // "And in your eyes, you're holding mine"
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        phrases: [
          // "Baby, I'm dancing in the dark"
          { chords: ["Em", "C", "G"], at: [0, 2, 5] },
          // "With you between my arms"
          { chords: ["D", "Em"], at: [0, 4] },
          // "Barefoot on the grass"
          { chords: ["C", "G"], at: [0, 3] },
          // "Listening to our favourite song"
          { chords: ["D", "Em"], at: [0, 4] },
          // "When you said you looked a mess"
          { chords: ["C", "G"], at: [0, 4] },
          // "I whispered underneath my breath"
          { chords: ["D", "Em"], at: [0, 3] },
          // "But you heard it"
          { chords: ["C"], at: [0] },
          // "Darling, you look perfect tonight"
          { chords: ["G", "D", "G"], at: [0, 2, 4] },
        ],
      },
    ],
    structure: ["verse", "prechorus", "chorus", "verse", "prechorus", "chorus", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/ed-sheeran/perfect-chords-1956589",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "someone-like-you",
    title: "Someone Like You",
    artist: "Adele",
    rootKey: "A",
    scaleType: "major",
    bpm: 135,
    defaultInstrument: "piano",
    defaultPatternId: "alberti",
    sections: [
      {
        id: "verse",
        label: "Verse",
        // UG: A A/G# F#m D × 3 cycles. LRClib has 6 verse lines (it merges
        // some of UG's short lines). Word positions placed where UG's
        // chord-letter sits above the LRC lyric.
        phrases: [
          // "I heard that you're settled down"  [0=I, 1=heard, 2=that, 3=you're, 4=settled, 5=down]
          { chords: ["A", "A/G#"], at: [0, 4] },
          // "That you found a girl and you're married now"  [0..8]
          { chords: ["F#m", "D"], at: [0, 5] },
          // "I heard that your dreams came true"
          { chords: ["A", "A/G#"], at: [0, 4] },
          // "Guess she gave you things I didn't give to you"
          { chords: ["F#m", "D"], at: [0, 5] },
          // "Old friend, why are you so shy?"
          { chords: ["A", "A/G#"], at: [0, 6] },
          // "Ain't like you to hold back or hide from the light"
          { chords: ["F#m", "D"], at: [0, 6] },
        ],
      },
      {
        id: "bridge",
        label: "Bridge",
        phrases: [
          // "I hate to turn up out of the blue, uninvited"  [I=0, blue=8, uninvited=9]
          { chords: ["E9", "F#m", "D"], at: [0, 7, 9] },
          // "But I couldn't stay away, I couldn't fight it" — D continues
          { chords: ["D"], at: [0] },
          // "I had hoped you'd see my face and that you'd be reminded"
          { chords: ["E9", "F#m", "D"], at: [0, 7, 11] },
          // "That, for me, it isn't over"  [That=0, isn't=4, over=5]
          { chords: ["E9/D", "D"], at: [4, 5] },
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        // UG places A/E/F#m/D at specific syllables per line. Word indices
        // are 0-based against the LRClib lyric (commas preserved as part
        // of their word: "me," is word index 2 in line 2).
        phrases: [
          // "Never mind, I'll find someone like you"
          //  0    1     2     3    4      5    6
          //                            A         E        F#m  D
          { chords: ["A", "E", "F#m", "D"], at: [0, 2, 4, 6] },
          // "I wish nothing but the best for you, too"
          //  0   1   2      3   4   5    6   7    8
          //          A              E         F#m   D
          { chords: ["A", "E", "F#m", "D"], at: [1, 4, 6, 7] },
          // "Don't forget me, I beg, I remember you said"
          //  0    1      2   3 4    5 6        7   8
          //         A         E        F#m       D
          { chords: ["A", "E", "F#m", "D"], at: [1, 4, 6, 8] },
          // "Sometimes it lasts in love, but sometimes it hurts instead"
          //  0         1  2     3  4     5   6         7  8     9
          //              A           E                       F#m   D
          { chords: ["A", "E", "F#m", "D"], at: [1, 4, 8, 9] },
          // Repeat — same placement.
          { chords: ["A", "E", "F#m", "D"], at: [1, 4, 8, 9] },
        ],
      },
      {
        id: "break",
        label: "Break",
        phrases: [
          // "Nothing compares no worries or cares"
          { chords: ["E/B"], at: [0] },
          // "Regrets and mistakes their memories make"
          { chords: ["F#m/C#"], at: [0] },
          // "Who would have known how"
          { chords: ["D"], at: [0] },
          // "Bitter-sweet this would taste"  [0..3]
          { chords: ["Bm", "A/C#", "D", "E/D"], at: [0, 1, 2, 3] },
        ],
      },
    ],
    structure: ["verse", "bridge", "chorus", "verse", "bridge", "chorus", "break", "chorus"],
    chartUrl: "https://tabs.ultimate-guitar.com/tab/adele/someone-like-you-chords-1006040",
    chartSource: "Ultimate Guitar",
  },

  {
    id: "let-it-be",
    title: "Let It Be",
    artist: "The Beatles",
    rootKey: "C",
    scaleType: "major",
    bpm: 73,
    defaultInstrument: "piano",
    defaultPatternId: "stride",
    sections: [
      {
        id: "verse",
        label: "Verse",
        phrases: [
          { chords: ["C", "G"], at: [0, 3] },
          { chords: ["Am", "F"], at: [0, 3] },
          { chords: ["C", "G"], at: [0, 3] },
          { chords: ["F", "C"], at: [0, 3] },
        ],
      },
      {
        id: "chorus",
        label: "Chorus",
        phrases: [
          { chords: ["Am", "G"], at: [0, 3] },
          { chords: ["F", "C"], at: [0, 3] },
          { chords: ["C", "G"], at: [0, 3] },
          { chords: ["F", "C"], at: [0, 3] },
        ],
      },
    ],
    structure: ["verse", "chorus", "verse", "chorus", "verse", "chorus"],
  },

  // ─── Practice piece — Korean ballad / K-Drama OST cadence ─────────────
  // A theory study of the classic K-ballad chord move: half-diminished into
  // altered dominants resolving to a 6/9 tonic. Emotion tones (b9, #9, #11)
  // are baked into the chord names so resolveChordSymbol voices them.
  {
    id: "k-ballad-lick",
    title: "K-Ballad Lick",
    artist: "Cadence Study",
    rootKey: "C",
    scaleType: "major",
    bpm: 72,
    defaultInstrument: "piano",
    defaultPatternId: "wave",
    sections: [
      {
        id: "cadence",
        label: "Cadence",
        phrases: [
          { chords: ["F#m7b5"], at: [0] },  // ii° of E minor — "chord tone"
          { chords: ["B7#9"], at: [0] },    // V/vi with #9 cell
          { chords: ["B7b9"], at: [0] },    // step up — b9 emotion
          { chords: ["Em7"], at: [0] },     // resolution to vi-of-G area
          { chords: ["A7b9"], at: [0] },    // V/ii with emotion tone
          { chords: ["A7#11"], at: [0] },   // lydian dominant continuation
          { chords: ["Dm11"], at: [0] },    // ii with 11th
          { chords: ["G13b9"], at: [0] },   // V13 — altered pre-dominant
          { chords: ["Csus4"], at: [0] },   // sus suspension
          { chords: ["C"], at: [0] },       // tonic
          { chords: ["C6/9"], at: [0] },    // 6/9 jazz tonic — "fine"
        ],
      },
    ],
    structure: ["cadence"],
  },
];

export function getSongById(id: string | null): Song | null {
  if (!id) return null;
  return SONGS.find((s) => s.id === id) ?? null;
}

export type SongCursor = {
  structureIdx: number;
  chordIdx: number;
};

export function nextCursor(song: Song, cursor: SongCursor): SongCursor {
  const section = song.sections.find((s) => s.id === song.structure[cursor.structureIdx]);
  const sectionLen = section ? sectionChordSymbols(section).length : 0;
  if (cursor.chordIdx + 1 < sectionLen) {
    return { ...cursor, chordIdx: cursor.chordIdx + 1 };
  }
  const nextStruct = (cursor.structureIdx + 1) % song.structure.length;
  return { structureIdx: nextStruct, chordIdx: 0 };
}

export function sectionAt(song: Song, cursor: SongCursor): SongSection | null {
  const id = song.structure[cursor.structureIdx];
  return song.sections.find((s) => s.id === id) ?? null;
}

// Returns the chord symbol the user is expected to play at this cursor
// position (e.g. "A/G#"). The reel highlights whichever palette slot matches.
export function expectedChordSymbol(song: Song, cursor: SongCursor): string | null {
  const section = sectionAt(song, cursor);
  if (!section) return null;
  return sectionChordSymbols(section)[cursor.chordIdx] ?? null;
}
