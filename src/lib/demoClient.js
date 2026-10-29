// Offline simulator with the same interface as ReaperClient (open the app with ?demo).
// It mimics the JSFX logic: quantized commands wait for the end of the loop.
import { CMD, EV, ST, PEND, parseShow, serializeShow } from './protocol';

const GRACE_S = 0.15;

function makeLooper(id, name, color, beats) {
  return {
    id, name, color, alive: true, ver: 15, beats, mode: 1, pos: 0, running: 1,
    fade: 0, fadeK: 0, fadeG: 1, fadeB0: 0, fadeB1: 0,
    fil: 0, lo: 1, mid: 1, hi: 1,
    tsNum: 4, tsDenom: 4, lenSec: 0, mon: 1, canDouble: 1, maxSec: 40,
    sections: Array.from({ length: 8 }, () => ({
      st: 0, pend: 0, has: 0, lvl: 0, pos: 0, beats: 0, lenSec: 0, gp: -1, vol: 1, pan: 0, mute: 0, cue: 0,
      fil: 0, lo: 1, mid: 1, hi: 1, fade: 0, fadeG: 1, fB0: 0, fB1: 0,
    })),
    lastPos: 0,
    undo: 0,
    undoSec: -1,
    undoSnap: null,
  };
}

export class DemoClient {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.tempo = 96;
    this.playing = true;
    this.t0 = performance.now();
    // ?demo=6 to try it with more instruments
    const extra = ['Tastiere', 'Sax', 'Percussioni', 'Cori', 'Synth', 'Violino', 'Loop FX'];
    const want = Math.max(1, Math.min(16, Number(new URLSearchParams(window.location.search).get('demo')) || 3));
    const base = [
      ['Chitarra', '#e0a030', 4],
      ['Basso', '#4f8fe0', 8],
      ['Voce', '#d0508a', 4],
    ];
    this.loopers = Array.from({ length: want }, (_, i) => {
      const [name, color, beats] = base[i] || [extra[(i - 3) % extra.length], '#7a8aa0', 4];
      return makeLooper(i + 1, name, color, beats);
    });
    // some content to look at
    const g = this.loopers[0].sections;
    Object.assign(g[0], { has: 1, st: ST.PLAYING, beats: 4 });
    Object.assign(g[1], { has: 1, st: ST.STOPPED, beats: 8 });
    Object.assign(g[2], { has: 1, st: ST.PLAYING, beats: 2 });
    if (this.loopers[1]) Object.assign(this.loopers[1].sections[0], { has: 1, st: ST.PLAYING, beats: 8 });
    this.loopers.slice(3).forEach((l, i) => Object.assign(l.sections[i % 8], { has: 1, st: ST.STOPPED, beats: 4 }));
    this.mem = Array.from({ length: 8 }, (_, i) => ({ slot: i + 1 }));
    this.mem[0] = { slot: 1, saved: '21/09 22:14', n: 3, tempo: '96' };
    this.job = null;
    this.saved = {};
    this.drums = { n: 2, mute: 0, pend: -1, gate: 1, sync: { bar: 0, auto: 0, len: 1, x: 0, n: 0, miss: 0, out: 1 } };
    this.synth = {
      ok: 1, fx: 'Splice INSTRUMENT (Splice)', cur: 'Piano Granular (Opia)', msg: '',
      list: [{ id: 1, name: 'Piano Granular (Opia)' }, { id: 2, name: 'Granular Choir (Astral Forms)' }],
    };
    this.uno = { dev: 4, name: 'UNO Drum', last: 0, sent: 0, err: '', ofs: 0, lead: 0, api: 1 };
    this.drumTarget = 0;
    // scaletta
    this.showText = '';
    this.showSlots = Array.from({ length: 8 }, (_, i) => ({ slot: i + 1 }));
    this.show = null;
    this.run = { st: 0, bar: 0 };
  }

  async setShow(text) {
    this.showText = text;
  }

  async getShow() {
    return this.showData || '';
  }

  barSec() {
    return 4 * (60 / this.tempo);
  }

  // esegue la scaletta come fa il bridge: prenota, aspetta ai punti di attesa
  runShow(tSec) {
    const r = this.run;
    if (!r.st || !this.show) return;
    if (r.st === 2) return;
    const bar = Math.floor((tSec - r.start - r.paused) / this.barSec()) + 1;
    r.bar = Math.max(1, bar);
    this.show.events.forEach((e, i) => {
      if (r.fired[i]) return;
      const at = r.start + r.paused + (e.bar - 1) * this.barSec();
      if (tSec < at) return;
      r.fired[i] = true;
      r.ndone = (r.ndone || 0) + 1;
      if (e.t === EV.WAIT) {
        r.st = 2;
        r.holdAt = at;
        return;
      }
      if (e.t === EV.PATTERN) {
        this.uno.last = e.v;
        this.uno.sent += 1;
        return;
      }
      if (e.t === EV.DRUMS) {
        if (e.v === 2 || (e.v === 0) !== (this.drums.mute === 1)) this.send(0, CMD.DRUMS);
        return;
      }
      if (e.t === EV.TEMPO) {
        if (e.v > 0) this.tempo = e.v / 100;
        return;
      }
      if (e.t === EV.STACCO) return; // in the demo there is no audio to silence
      if (e.t === EV.CLEAR) {
        const ids = e.l === 0 ? this.loopers.map((x) => x.id) : [e.l];
        ids.forEach((id) => {
          if (e.l !== 0 && e.s >= 0) this.send(id, CMD.CLEAR_SECTION, e.s);
          else this.send(id, CMD.CLEAR_ALL);
        });
        return;
      }
      if (e.t >= EV.FILTER && e.t <= EV.EQ_HI) {
        // the demo jumps straight to the value (the real JSFX does the transition)
        const val = e.v % 256;
        const sec = e.s >= 0 ? e.s : 0;
        const ids = e.l === 0 ? this.loopers.map((x) => x.id) : [e.l];
        ids.forEach((id) => {
          if (e.t === EV.FILTER) {
            if (e.s >= 0) this.send(id, CMD.FILTER_SEC, sec + 8 * val);
            else this.send(id, CMD.FILTER, val);
          } else {
            const band = e.t - EV.EQ_LO;
            if (e.s >= 0) this.send(id, CMD.EQ_SEC, sec + 8 * (band + 3 * val));
            else this.send(id, CMD.EQ, band + 3 * val);
          }
        });
        return;
      }
      if (e.t === EV.SYNTH) {
        const x = this.synth.list.find((y) => y.id === e.v);
        if (x) this.synth.cur = x.name;
        return;
      }
      const l = this.loopers.find((x) => x.id === e.l);
      if (!l) return;
      const sec = e.s >= 0 ? e.s : 0;
      if (e.t === EV.REC) {
        // rifatta dopo Indietro: se sta gia' registrando resta in rec (la take riparte)
        if (!(r.redo && r.redo[i] && l.sections[sec].st >= ST.RECORDING)) this.send(l.id, CMD.HOLD, sec);
      }
      else if (e.t === EV.CUE_REC) this.send(l.id, CMD.CUE_REC, sec);
      else if (e.t === EV.PLAY) { const x = l.sections[sec]; if (x.has && x.st < ST.PLAYING) this.exec(l, sec, PEND.PLAY); }
      else if (e.t === EV.PAUSE) this.exec(l, sec, PEND.STOP);
      else if (e.t === EV.PLAY_ALL) this.send(l.id, CMD.PLAY_ALL);
      else if (e.t === EV.STOP_ALL) this.send(l.id, CMD.STOP_ALL);
      else if (e.t === EV.FADE_IN || e.t === EV.FADE_OUT) {
        const dir = e.t === EV.FADE_IN ? 1 : 0;
        if (e.s >= 0) this.send(l.id, CMD.FADE_SEC, sec + 8 * (e.v * 2 + dir));
        else this.send(l.id, CMD.FADE, e.v * 2 + dir);
      } else if (e.t === EV.DRUMS) {
        if ((e.v === 0) !== (this.drums.mute === 1)) this.send(0, CMD.DRUMS);
      } else if (e.t === EV.TEMPO && e.v > 0) {
        this.tempo = e.v / 100;
      } else if (e.t === EV.PATTERN) {
        this.uno.last = e.v;
        this.uno.sent += 1;
      }
    });
    const last = this.show.events.reduce((a, e) => Math.max(a, e.bar), 0);
    if (tSec > r.start + r.paused + Math.max(last, this.show.bars) * this.barSec()) r.st = 0;
  }

  start() {
    const step = () => {
      this.tick();
      this.raf = requestAnimationFrame(step);
    };
    step();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  beatSec(l) {
    return (60 / this.tempo) * (4 / l.tsDenom);
  }

  measureSec() {
    return 4 * (60 / this.tempo);
  }

  tick() {
    const now = performance.now();
    const tSec = (now - this.t0) / 1000;
    // drum machine: the mute lands at the end of the bar
    if (this.drums.pend >= 0 && (!this.playing || Math.floor(tSec / this.measureSec()) >= this.drumTarget)) {
      this.drums.mute = this.drums.pend;
      this.drums.pend = -1;
    }
    for (const l of this.loopers) {
      l.lenSec = l.beats * this.beatSec(l);
      l.running = this.playing ? 1 : 0;
      if (this.playing) l.pos = (tSec % l.lenSec) / l.lenSec;
      l.sections.forEach((s, i) => {
        if (s.beats) {
          s.lenSec = s.beats * this.beatSec(l);
          s.pos = (tSec % s.lenSec) / s.lenSec;
        }
        if (!s.pend || !this.playing) return;
        // pending action: new takes follow the rec length, the rest the section's own loop
        const gp = this.gridPos(l, s);
        if (s.gp >= 0 && gp < s.gp - 0.5) this.exec(l, i, s.pend);
        else s.gp = gp;
      });
      // fade of the looper: out ends with everything in pause, in arrives at full
      if (l.fade > 0) {
        if (!this.playing) {
          l.fade = 0;
          l.fadeK = 0;
          l.fadeG = 1;
        } else if (tSec >= l.fadeB1) {
          if (l.fadeK === 1) {
            l.sections.forEach((x) => {
              x.pend = 0;
              x.gp = -1;
              if (x.st >= ST.RECORDING) x.has = 1;
              x.st = x.has ? ST.STOPPED : ST.EMPTY;
            });
          }
          l.fade = 0;
          l.fadeK = 0;
          l.fadeG = 1;
        } else {
          const left = (l.fadeB1 - tSec) / Math.max(l.fadeB1 - l.fadeB0, 0.001);
          l.fadeG = Math.max(0, Math.min(1, l.fadeK === 1 ? left : 1 - left));
        }
      }
      // fade of a single section
      l.sections.forEach((x) => {
        if (!x.fade) return;
        if (!this.playing) {
          x.fade = 0;
          x.fadeG = 1;
        } else if (tSec >= x.fB1) {
          if (x.fade === 1) {
            x.pend = 0;
            x.gp = -1;
            x.st = x.has ? ST.STOPPED : ST.EMPTY;
          }
          x.fade = 0;
          x.fadeG = 1;
        } else {
          const left = (x.fB1 - tSec) / Math.max(x.fB1 - x.fB0, 0.001);
          x.fadeG = Math.max(0, Math.min(1, x.fade === 1 ? left : 1 - left));
        }
      });
      l.canDouble = l.beats * 2 * this.beatSec(l) <= 40 ? 1 : 0;
      for (const s of l.sections) {
        const active = s.st >= ST.PLAYING;
        s.lvl = active ? 0.35 + 0.35 * Math.abs(Math.sin(now / 90 + s.has)) : s.lvl * 0.8;
      }
    }
    this.runShow(tSec);
    this.onUpdate(this.snapshot(), 'ok', now);
  }

  snapshot() {
    if (this.job && !this.job.done) {
      this.job.p = Math.min(1, (performance.now() - this.job.t0) / 1500);
      if (this.job.p >= 1) this.finishJob();
    }
    if (this.job && this.job.done && performance.now() - this.job.doneAt > 5000) this.job = null;
    return {
      demo: true,
      mem: this.mem,
      show: {
        st: this.run.st,
        bar: this.run.bar,
        back: this.run.st && this.run.back && (performance.now() - this.t0) / 1000 < this.run.backUntil ? this.run.back : 0,
        name: this.show ? this.show.name : '',
        bars: this.show ? this.show.bars : 0,
        n: this.show ? this.show.events.length : 0,
        next: this.run.st && this.show
          ? (() => {
              const e = this.show.events.find((_, i) => !this.run.fired[i]);
              return e ? `bar ${e.bar}` : '';
            })()
          : '',
        ver: 15,
        book: this.run.nbook || 0,
        done: this.run.ndone || 0,
        fall: 0,
        slots: this.showSlots,
      },
      drums: { ...this.drums, sync: { ...this.drums.sync }, uno: { ...this.uno } },
      synth: { ...this.synth, list: [...this.synth.list] },
      job: this.job && { kind: this.job.kind, slot: this.job.slot, p: this.job.p, done: this.job.done, msg: this.job.msg, err: '' },
      playing: this.playing,
      tempo: this.tempo,
      loopers: this.loopers.map((l) => ({ ...l, undoSnap: undefined, sections: l.sections.map((s) => ({ ...s })) })),
    };
  }

  finishJob() {
    const j = this.job;
    j.done = true;
    j.doneAt = performance.now();
    j.p = 1;
    if (j.kind === 'save') {
      const n = this.loopers.reduce((a, l) => a + l.sections.filter((x) => x.has).length, 0);
      this.saved[j.slot] = JSON.parse(JSON.stringify(this.loopers.map((l) => l.sections)));
      const d = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      this.mem[j.slot - 1] = { slot: j.slot, saved: `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`, n, tempo: String(this.tempo) };
      j.msg = `${n} sezioni salvate`;
    } else {
      const data = this.saved[j.slot];
      if (data) this.loopers.forEach((l, i) => data[i] && (l.sections = data[i].map((x) => ({ ...x, st: x.has ? ST.STOPPED : 0, pend: 0 }))));
      j.msg = `${this.mem[j.slot - 1].n || 0} sezioni caricate`;
    }
  }

  exec(l, i, act) {
    const s = l.sections[i];
    s.pend = 0;
    s.gp = -1;
    if (act === PEND.REC) {
      if (s.st <= ST.PLAYING) {
        l.undoSec = i;
        l.undo = 0;
        l.undoSnap = { has: s.has, beats: s.beats };
      }
      if (s.st === ST.PLAYING) s.st = ST.OVERDUB;
      else if (s.st <= ST.STOPPED) Object.assign(s, { st: ST.RECORDING, has: 1, beats: l.beats });
    } else if (act === PEND.PLAY) {
      if (s.st >= ST.RECORDING && l.undoSec === i) l.undo = 1;
      if (s.st >= ST.RECORDING && s.recPause) {
        s.recPause = 0;
        s.cue = 0; // after a silent rec the section is an ordinary one, in pause
        s.st = ST.STOPPED;
      } else if (s.st >= ST.RECORDING || s.has) s.st = ST.PLAYING;
    } else if (act === PEND.STOP) {
      s.st = s.has ? ST.STOPPED : ST.EMPTY;
    }
  }

  // where a fade lands: on a bar line from 1 bar up, on the fade itself below that
  fadeGrid(l, bars) {
    const bar = (l.tsNum || 4) * this.beatSec(l);
    const t = (performance.now() - this.t0) / 1000;
    const u = Math.min(bars, 1) * bar;
    let end = (Math.floor(t / u) + 1) * u + Math.max(0, bars - 1) * bar;
    if (end - t < u * 0.125) end += u;
    return [t, end];
  }

  boundary(l) {
    l.sections.forEach((s, i) => s.pend && this.exec(l, i, s.pend));
  }

  isNewTake(s, act = s.pend) {
    return act === PEND.REC && s.st <= ST.STOPPED;
  }

  gridPos(l, s, act) {
    return this.isNewTake(s, act) || !s.beats ? l.pos : s.pos;
  }

  request(l, i, act) {
    const s = l.sections[i];
    const gp = this.gridPos(l, s, act);
    const lenSec = this.isNewTake(s, act) || !s.beats ? l.lenSec : s.lenSec;
    if (!l.mode) this.exec(l, i, act);
    else if (this.playing && gp * lenSec < GRACE_S) this.exec(l, i, act);
    else Object.assign(s, { pend: act, gp });
  }

  send(target, code, arg = 0) {
    if (code === CMD.TRANSPORT) {
      this.playing = !this.playing;
      if (this.playing) this.t0 = performance.now();
      return;
    }
    if ((code === CMD.TAP || code === CMD.HOLD || code === CMD.PLAY_ALL) && !this.playing) {
      this.playing = true;
      this.t0 = performance.now();
    }
    if (code === CMD.DRUM_SYNC) {
      const sy = this.drums.sync;
      clearTimeout(this.syncT);
      if (sy.bar) { sy.bar = 0; return; }
      const m = this.measureSec();
      const t = (performance.now() - this.t0) / 1000;
      sy.bar = Math.floor(t / m) + 2;
      this.syncT = setTimeout(() => { sy.bar = 0; sy.n += 1; }, (Math.ceil(t / m) * m - t) * 1000 + 300);
      return;
    }
    if (code === CMD.DRUM_SYNC_SET) {
      this.drums.sync.auto = arg % 2;
      this.drums.sync.len = Math.max(1, Math.floor(arg / 2));
      return;
    }
    if (code === CMD.DRUMS) {
      if (this.drums.pend >= 0) { this.drums.pend = -1; return; } // a second press cancels
      const want = this.drums.mute ? 0 : 1;
      const m = this.measureSec();
      const t = (performance.now() - this.t0) / 1000;
      if (!this.playing || t % m < GRACE_S) { this.drums.mute = want; return; }
      this.drums.pend = want;
      this.drumTarget = Math.floor(t / m) + 1;
      return;
    }
    if (code === CMD.UNO_PATTERN) {
      this.uno.last = arg;
      this.uno.sent += 1;
      return;
    }
    if (code === CMD.SYNTH_SAVE) {
      const n = this.synth.list.length + 1;
      const name = `Suono demo ${n}`;
      this.synth.list.push({ id: Math.max(0, ...this.synth.list.map((x) => x.id)) + 1, name });
      this.synth.cur = name;
      this.synth.msg = `Salvato: ${name}`;
      return;
    }
    if (code === CMD.SYNTH_LOAD) {
      const x = this.synth.list.find((y) => y.id === arg);
      if (x) this.synth.cur = x.name;
      return;
    }
    if (code === CMD.SYNTH_DELETE) {
      this.synth.list = this.synth.list.filter((y) => y.id !== arg);
      return;
    }
    if (code === CMD.UNO_SET) {
      this.uno.ofs = arg % 2;
      this.uno.lead = Math.floor(arg / 2);
      return;
    }
    if ((code >= CMD.SHOW_SET && code <= CMD.SHOW_CONTINUE) || code === CMD.SHOW_BACK) {
      const t = (performance.now() - this.t0) / 1000;
      if (code === CMD.SHOW_SET) this.show = parseShow(this.showText);
      else if (code === CMD.SHOW_SAVE && this.show) {
        this.savedShows = this.savedShows || {};
        this.savedShows[arg] = serializeShow(this.show);
        this.showSlots[arg - 1] = { slot: arg, name: this.show.name, bars: this.show.bars, n: this.show.events.length };
      } else if (code === CMD.SHOW_LOAD) {
        this.showData = (this.savedShows || {})[arg] || '';
        this.show = parseShow(this.showData);
        this.run = { st: 0, bar: 0 };
      } else if (code === CMD.SHOW_DELETE) {
        if (this.savedShows) delete this.savedShows[arg];
        this.showSlots[arg - 1] = { slot: arg };
      } else if (code === CMD.SHOW_START && this.show) {
        const bar = this.barSec();
        this.playing = true;
        this.run = { st: 1, bar: 1, start: Math.ceil(t / bar) * bar, paused: 0, fired: {} };
      } else if (code === CMD.SHOW_STOP) this.run = { st: 0, bar: 0 };
      else if (code === CMD.SHOW_BACK && this.run.st === 1) {
        const r = this.run;
        const bar = this.barSec();
        const cur = Math.floor((t - r.start - r.paused) / bar) + 1;
        if (cur < 1) return;
        const REDO = [EV.REC, EV.PLAY, EV.PAUSE, EV.CUE_REC, EV.PLAY_ALL, EV.STOP_ALL, EV.PATTERN, EV.STACCO, EV.SYNTH, EV.TEMPO];
        r.redo = r.redo || {};
        this.show.events.forEach((e, i) => {
          if (e.bar >= cur && r.fired[i] && REDO.includes(e.t)) {
            delete r.fired[i];
            r.redo[i] = true;
          }
        });
        if (!(t < r.backUntil)) r.back = 0;
        r.paused += bar;
        r.back = (r.back || 0) + 1;
        r.backUntil = r.start + r.paused + (cur - 1) * bar;
      } else if (code === CMD.SHOW_CONTINUE && this.run.st === 2) {
        const bar = this.barSec();
        this.run.paused += Math.ceil(t / bar) * bar - this.run.holdAt;
        this.run.st = 1;
      }
      return;
    }
    if (code === CMD.SAVE || code === CMD.LOAD) {
      if (this.job && !this.job.done) return;
      this.job = { kind: code === CMD.SAVE ? 'save' : 'load', slot: arg, p: 0, t0: performance.now(), done: false, msg: '' };
      return;
    }
    if (code === CMD.TAP) arg %= 8; // arg also carries the double-tap delay
    for (const l of this.loopers) {
      if (target !== 0 && target !== l.id) continue;
      const s = l.sections[arg % 8];
      switch (code) {
        case CMD.TAP:
          if (s.pend) {
            s.pend = 0;
            if (s.recPause && s.st < ST.RECORDING) { s.recPause = 0; s.cue = 0; }
          }
          else if (s.st >= ST.RECORDING) {
            // a silent rec ends on the spot, it is going to pause anyway
            if (s.recPause) this.exec(l, arg, PEND.STOP);
            else this.request(l, arg, PEND.PLAY);
          }
          else if (s.st === ST.PLAYING) this.request(l, arg, PEND.STOP);
          else if (s.has) this.request(l, arg, PEND.PLAY);
          break;
        case CMD.HOLD:
          if (s.pend === PEND.REC) s.pend = 0;
          else if (s.st < ST.RECORDING) this.request(l, arg, PEND.REC);
          break;
        case CMD.PLAY_ALL:
          l.sections.forEach((x, i) => x.has && x.st < ST.PLAYING && x.pend !== PEND.PLAY && this.request(l, i, PEND.PLAY));
          break;
        case CMD.STOP_ALL:
          l.sections.forEach((x, i) => (x.st >= ST.PLAYING ? this.request(l, i, PEND.STOP) : (x.pend = 0)));
          break;
        case CMD.MODE:
          l.mode = arg ? 1 : 0;
          if (!l.mode) this.boundary(l);
          break;
        case CMD.SET_BEATS: {
          const beats = arg / 2;
          if (beats >= 0.5 && beats * this.beatSec(l) <= l.maxSec) l.beats = beats;
          break;
        }
        case CMD.SET_SEC_BEATS: {
          const x = l.sections[arg % 8];
          const beats = Math.floor(arg / 8) / 2;
          if (x.has && x.st !== ST.RECORDING && beats >= 0.5 && beats * this.beatSec(l) <= l.maxSec) x.beats = beats;
          break;
        }
        case CMD.HALVE:
          if (l.beats / 2 >= 0.5) l.beats /= 2;
          break;
        case CMD.DOUBLE:
          if (l.canDouble) l.beats *= 2;
          break;
        case CMD.CLEAR_ALL:
          l.sections.forEach((x) => Object.assign(x, { st: 0, pend: 0, has: 0, beats: 0, lenSec: 0 }));
          break;
        case CMD.CLEAR_SECTION:
          Object.assign(s, { st: 0, pend: 0, has: 0, beats: 0, lenSec: 0 });
          break;
        case CMD.HALVE_SECTION:
          if (s.has && s.st !== ST.RECORDING && s.beats / 2 >= 0.5) s.beats /= 2;
          break;
        case CMD.DOUBLE_SECTION:
          if (s.has && s.st !== ST.RECORDING && s.lenSec * 2 <= l.maxSec) s.beats *= 2;
          break;
        case CMD.VOLUME:
          l.sections[arg % 8].vol = Math.floor(arg / 8) / 100;
          break;
        case CMD.PAN:
          l.sections[arg % 8].pan = (Math.floor(arg / 8) - 100) / 100;
          break;
        case CMD.CUE_REC:
          if (s.st < ST.PLAYING) {
            s.cue = 1;
            s.recPause = 1;
            if (s.pend === PEND.REC) { s.pend = 0; s.cue = 0; s.recPause = 0; }
            else this.request(l, arg, PEND.REC);
          }
          break;
        case CMD.CUE:
          s.cue = s.cue ? 0 : 1;
          break;
        case CMD.MUTE:
          l.sections[arg].mute = l.sections[arg].mute ? 0 : 1;
          break;
        case CMD.UNDO: {
          const u = l.sections[l.undoSec];
          if (!u || !l.undo) break;
          const cur = { has: u.has, beats: u.beats };
          Object.assign(u, l.undoSnap);
          if (!u.has) u.st = 0;
          else if (!u.st) u.st = ST.STOPPED;
          l.undoSnap = cur;
          l.undo = 3 - l.undo;
          break;
        }
        case CMD.FADE: {
          if (!l.mode) break;                       // only in Bar mode
          if (l.fade > 0) { l.fade = 0; l.fadeK = 0; l.fadeG = 1; break; } // second press = cancel
          const dir = arg % 2;                      // arg = half bars * 2 + dir
          const bars = Math.max(0.125, Math.min(32, Math.floor(arg / 2) / 2));
          const [b0, b1] = this.fadeGrid(l, bars);
          l.fadeB0 = b0;
          l.fadeB1 = b1;
          l.fade = bars;
          l.fadeK = dir ? 2 : 1;
          l.fadeG = dir ? 0 : 1;
          if (dir) l.sections.forEach((x, i) => { if (x.has && x.st < ST.PLAYING) this.exec(l, i, PEND.PLAY); });
          break;
        }
        case CMD.FADE_SEC: {
          if (!l.mode) break;
          const x = l.sections[arg % 8];
          const v = Math.floor(arg / 8);
          if (x.fade > 0) { x.fade = 0; x.fadeG = 1; break; }
          const dir = v % 2;
          const bars = Math.max(0.125, Math.min(32, Math.floor(v / 2) / 2));
          if (!dir && x.st < ST.PLAYING) break;     // nothing to fade out
          const [b0, b1] = this.fadeGrid(l, bars);
          x.fB0 = b0;
          x.fB1 = b1;
          x.fade = dir ? 2 : 1;
          x.fadeG = dir ? 0 : 1;
          if (dir && x.has && x.st < ST.PLAYING) this.exec(l, arg % 8, PEND.PLAY);
          break;
        }
        case CMD.TAP_NOW: {
          const x = l.sections[arg % 8];
          const i = arg % 8;
          if (x.pend) {
            x.pend = 0;
            if (x.recPause && x.st < ST.RECORDING) { x.recPause = 0; x.cue = 0; }
          } else if (x.st >= ST.RECORDING) this.exec(l, i, x.recPause ? PEND.STOP : PEND.PLAY);
          else if (x.st === ST.PLAYING) this.exec(l, i, PEND.STOP);
          else if (x.has) this.exec(l, i, PEND.PLAY);
          break;
        }
        case CMD.FILTER:
          l.fil = (arg - 100) / 100;
          break;
        case CMD.EQ: {
          const band = arg % 3;
          const g = Math.floor(arg / 3) / 100;
          l[['lo', 'mid', 'hi'][band]] = g;
          break;
        }
        case CMD.FILTER_SEC:
          l.sections[arg % 8].fil = (Math.floor(arg / 8) - 100) / 100;
          break;
        case CMD.EQ_SEC: {
          const x = l.sections[arg % 8];
          const v = Math.floor(arg / 8);
          x[['lo', 'mid', 'hi'][v % 3]] = Math.floor(v / 3) / 100;
          break;
        }
        case CMD.FX_RESET: {
          const clear = (o) => Object.assign(o, { fil: 0, lo: 1, mid: 1, hi: 1 });
          if (arg === 0) clear(l);
          else if (arg === 9) { clear(l); l.sections.forEach(clear); }
          else clear(l.sections[arg - 1]);
          break;
        }
        case CMD.MONITOR:
          l.mon = l.mon ? 0 : 1;
          break;
        default:
      }
    }
  }
}
