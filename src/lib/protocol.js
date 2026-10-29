// Command codes understood by MyLooper.jsfx (see header of the JSFX)
export const CMD = {
  TAP: 1,          // arg = section
  HOLD: 2,         // arg = section (record / overdub)
  PLAY_ALL: 3,
  STOP_ALL: 4,
  MODE: 5,         // arg = 0 immediate, 1 bar
  HALVE: 6,
  DOUBLE: 7,
  CLEAR_ALL: 8,
  CLEAR_SECTION: 9,
  MONITOR: 10,
  HALVE_SECTION: 11,  // arg = section
  DOUBLE_SECTION: 12, // arg = section
  VOLUME: 13,         // arg = volArg(section, 0..2)
  PAN: 14,            // arg = panArg(section, -1..1)
  MUTE: 15,           // arg = section (toggle)
  UNDO: 16,           // undo / redo the last rec of the looper
  SET_BEATS: 17,      // arg = beats*2: exact length of the next rec
  CUE_REC: 18,        // arg = section: silent rec (cue bus, ends in pause)
  CUE: 19,            // arg = section: toggle cue / main
  FADE: 20,           // arg = fadeArg(bars, dir): fade of the looper (Bar mode only)
  FADE_SEC: 21,       // arg = fadeSecArg(section, bars, dir): fade of one section
  TAP_NOW: 22,        // arg = section: play / pause right away (double tap)
  FILTER: 23,         // arg = filterArg(-1..1): DJ filter of the looper
  EQ: 24,             // arg = eqArg(band, 0..2): 3 band kill of the looper
  FILTER_SEC: 25,     // arg = filterSecArg(section, -1..1)
  EQ_SEC: 26,         // arg = eqSecArg(section, band, 0..2)
  FX_RESET: 27,       // arg: 0 = looper, 1 + section, 9 = everything
  SCHED: 28,          // arg = section + 8*act + 64*(beat*2): booked by the scaletta
  SET_SEC_BEATS: 30,  // arg = section + 8*(beats*2): exact length of a section
  STACCO: 31,         // arg = t + 16*(dur*4 + 1024*beat*4): silence window (scaletta)
  TRANSPORT: 100,  // handled by the Lua bridge: REAPER play/stop
  SAVE: 200,       // bridge: save all loopers in memory slot (arg 1..8)
  LOAD: 201,       // bridge: load memory slot (arg 1..8)
  DRUMS: 202,      // bridge: drum machine on / off (mute of its tracks, at the end of the bar)
  DRUM_SYNC: 203,  // bridge: put the drum machine back on the bar (Stop + Start on a bar line)
  DRUM_SYNC_SET: 204, // bridge: arg = auto (0/1) + 2*pattern length in bars
  SHOW_SET: 210,   // bridge: read the scaletta from the ExtState "show"
  SHOW_SAVE: 211,  // arg = slot 1..8
  SHOW_LOAD: 212,
  SHOW_DELETE: 213,
  SHOW_START: 214,
  SHOW_STOP: 215,
  SHOW_CONTINUE: 216,
  SHOW_BACK: 219,   // bridge: the scaletta goes back one bar (redo the bar you are in)
  UNO_PATTERN: 217, // bridge: drum machine to pattern arg (1..100) right now
  UNO_SET: 218,     // bridge: pattern settings, arg = ofs + 2*lead (eighths)
  SYNTH_SAVE: 220,  // bridge: save the current sound of the synth as a preset
  SYNTH_LOAD: 221,  // bridge: load sound id
  SYNTH_DELETE: 222, // bridge: delete sound id
};

export const ALL_LOOPERS = 0;

// must match MyLooper.jsfx (gmem +11) and MyLooper_bridge.lua
export const PROTO = 15;

// Section states
export const ST = { EMPTY: 0, STOPPED: 1, PLAYING: 2, RECORDING: 3, OVERDUB: 4 };
// Pending actions
export const PEND = { NONE: 0, STOP: 1, PLAY: 2, REC: 3 };

export const HOLD_MS = 800;
// a single tap waits this long to see if it becomes a double tap (= select)
export const DOUBLE_TAP_MS = 250;

// fade length: halves and doubles like the rec length, from half a bar to 32
export const FADE_STEPS = [0.5, 1, 2, 4, 8, 16, 32];
export const FADE_MIN = FADE_STEPS[0];
export const FADE_MAX = FADE_STEPS[FADE_STEPS.length - 1];
// sent in quarter bars, so half a bar survives the integer protocol, plus the
// direction in the last bit: 0 = fade out, 1 = fade in
export const FADE_OUT = 0;
export const FADE_IN = 1;
const halfBars = (bars) => Math.round(Math.max(FADE_MIN, Math.min(FADE_MAX, bars)) * 2);
export const fadeArg = (bars, dir = FADE_OUT) => halfBars(bars) * 2 + (dir ? 1 : 0);
export const fadeSecArg = (section, bars, dir = FADE_OUT) => section + 8 * fadeArg(bars, dir);

// filter: -1 low pass ... 0 off ... +1 high pass. EQ bands: 0 low, 1 mid, 2 high (0..2, 1 = flat)
export const EQ_BANDS = ['lo', 'mid', 'hi'];
const filPct = (v) => Math.round((Math.max(-1, Math.min(1, v)) + 1) * 100);
const eqPct = (g) => Math.round(Math.max(0, Math.min(2, g)) * 100);
export const filterArg = (v) => filPct(v);
export const filterSecArg = (section, v) => section + 8 * filPct(v);
export const eqArg = (band, g) => band + 3 * eqPct(g);
export const eqSecArg = (section, band, g) => section + 8 * (band + 3 * eqPct(g));

// ---------- scaletta: the arrangement written down in advance ----------
// An event is { bar, t, l, s, v }: bar (1 based), type, looper id (0 = general),
// section (-1 = the whole looper), value.
export const EV = {
  REC: 1,
  PLAY: 2,
  PAUSE: 3,
  CUE_REC: 4,
  FADE_IN: 5,
  FADE_OUT: 6,
  FILTER: 7,
  EQ_LO: 8,
  EQ_MID: 9,
  EQ_HI: 10,
  DRUMS: 11,
  TEMPO: 12,
  WAIT: 13,
  PLAY_ALL: 14,
  STOP_ALL: 15,
  PATTERN: 16,   // v = pattern of the drum machine (1..100)
  STACCO: 17,    // v = stacArg(pos, dur, drum): silence inside the bar
  SYNTH: 18,     // v = id of the synth sound
  CLEAR: 19,     // scarta: empties the section / the instrument / everything, on the bar
};

export const EV_INFO = {
  [EV.REC]: { icon: '●', label: 'Rec', cls: 'rec' },
  [EV.PLAY]: { icon: '▶', label: 'Play', cls: 'play' },
  [EV.PAUSE]: { icon: '❚❚', label: 'Pausa', cls: 'stop' },
  [EV.CUE_REC]: { icon: '◉', label: 'Rec in cuffia', cls: 'cue' },
  [EV.FADE_IN]: { icon: '▲', label: 'Fade in', cls: 'fade' },
  [EV.FADE_OUT]: { icon: '▼', label: 'Fade out', cls: 'fade' },
  [EV.FILTER]: { icon: 'FIL', label: 'Filtro', cls: 'fx' },
  [EV.EQ_LO]: { icon: 'BAS', label: 'Bassi', cls: 'fx' },
  [EV.EQ_MID]: { icon: 'MED', label: 'Medi', cls: 'fx' },
  [EV.EQ_HI]: { icon: 'ALT', label: 'Alti', cls: 'fx' },
  [EV.DRUMS]: { icon: 'DRM', label: 'Drum machine', cls: 'drum' },
  [EV.TEMPO]: { icon: 'BPM', label: 'BPM', cls: 'drum' },
  [EV.WAIT]: { icon: 'ATT', label: 'Aspetta che prema', cls: 'wait' },
  [EV.PLAY_ALL]: { icon: '▶▶', label: 'Play di tutte', cls: 'play' },
  [EV.STOP_ALL]: { icon: '■', label: 'Stop di tutte', cls: 'stop' },
  [EV.PATTERN]: { icon: 'PAT', label: 'Pattern drum', cls: 'drum' },
  [EV.STACCO]: { icon: 'STC', label: 'Stacco', cls: 'stacco' },
  [EV.SYNTH]: { icon: 'SYN', label: 'Suono synth', cls: 'synth' },
  [EV.CLEAR]: { icon: '✕', label: 'Scarta', cls: 'clear' },
};

// stacco: position and length in eighths (pos 0 = on the 1 of the bar), drum = the
// drum machine stops too (only from the Generale row)
// filter / EQ in the scaletta: value 0..200 + transition in quarter bars (0 = right away)
export const fxEvArg = (val, bars = 0) => Math.round(val) + 256 * Math.round(Math.max(0, bars) * 4);
export const fxEvParts = (v) => ({ val: v % 256, bars: Math.floor(v / 256) / 4 });

// who stops (Generale only): 'all' loopers + drum, 'loopers' only, 'drum' only
export const stacArg = (pos, dur, who = 'loopers') =>
  Math.max(0, Math.min(63, Math.round(pos))) + 64 * Math.max(1, Math.min(63, Math.round(dur))) +
  (who === 'all' || who === true ? 4096 : 0) + (who === 'drum' ? 8192 : 0);
export const stacParts = (v) => {
  const drum = Math.floor(v / 4096) % 2 === 1;
  const onlyDrum = Math.floor(v / 8192) % 2 === 1;
  return { pos: v % 64, dur: Math.floor(v / 64) % 64, drum, onlyDrum, who: onlyDrum ? 'drum' : drum ? 'all' : 'loopers' };
};
// "1/8", "3/4", "1 bar"... for an eighth count, with the bar of this time signature
export function eighthsLabel(n, barEighths = 8) {
  if (n % barEighths === 0) return `${n / barEighths} bar`;
  if (n % 2 === 0) return `${n / 2}/4`;
  return `${n}/8`;
}
// "sul 1", "sul 2 e" (the eighth after the 2)
export const posLabel = (pos) => `sul ${Math.floor(pos / 2) + 1}${pos % 2 ? ' e' : ''}`;

// niente caratteri che darebbero fastidio nell'URL o nel formato
const clean = (s) => String(s || '').replace(/[^\w .\-àèéìòù]/gi, ' ').slice(0, 40);

export function serializeShow(show) {
  const evs = (show.events || [])
    .slice()
    .sort((a, b) => a.bar - b.bar || a.t - b.t)
    .map((e) => `${e.bar},${e.t},${e.l},${e.s},${Math.round(e.v || 0)}`)
    .join(';');
  return `v1|${clean(show.name)}|${show.bars || 32}|${Math.round(show.tempo || 0)}|${evs}`;
}

export function parseShow(text) {
  const m = /^v\d+\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/.exec(text || '');
  if (!m) return null;
  const events = m[4]
    ? m[4]
        .split(';')
        .filter(Boolean)
        .map((ev) => {
          const p = ev.split(',').map(Number);
          return { bar: p[0], t: p[1], l: p[2], s: p[3], v: p[4] };
        })
        .filter((e) => e.bar > 0 && e.t > 0)
    : [];
  return { name: m[1], bars: Number(m[2]) || 32, tempo: Number(m[3]) || 0, events };
}

// TAP arg carries how long the UI held the tap back, so the JSFX can widen its grace window
export const tapArg = (section, lateMs) => section + 8 * Math.round(lateMs);
export const volArg = (section, vol) => section + 8 * Math.round(Math.max(0, Math.min(2, vol)) * 100);
export const panArg = (section, pan) => section + 8 * Math.round(Math.max(-1, Math.min(1, pan)) * 100 + 100);
