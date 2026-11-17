import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_LOOPERS, CMD, EV, EV_INFO, MACHINE_ROW, mergeShows, parseShow, serializeShow } from '../lib/protocol';
import HoldButton from './HoldButton';
import MachinesBox from './MachinesBox';
import {
  EventPicker, GEN_ACTIONS, LEADS, LOOP_ACTIONS, MACH_ACTIONS, SEC_ACTIONS,
} from './ShowParts';

// La scaletta: il pezzo scritto prima. Righe = strumenti e sezioni, colonne = bar.
// Tocchi una casella e scegli cosa deve succedere lì; dal vivo premi Avvia e il
// looper fa da solo. Le "attese" tengono tutto fermo finché non tocchi Continua.

const GEN = 'gen';
const rowKey = (l, s) => (l === 0 ? GEN : `${l}:${s}`);

// Drum machine: provare un pattern al volo e regolare come arriva il cambio
function DrumBox({ uno, gate, sync, send, vst }) {
  const [n, setN] = useState(1);
  const ofs = uno?.ofs || 0;
  const lead = uno?.lead || 0;
  const set = (o, l) => send(ALL_LOOPERS, CMD.UNO_SET, o + 2 * l);
  const auto = sync ? sync.auto : 1;
  const plen = sync ? sync.len : 1;
  const setSync = (a, len) => send(ALL_LOOPERS, CMD.DRUM_SYNC_SET, a + 2 * len);
  return (
    <div className="drumbox">
      <div className="drumbox__row">
        <strong>A tempo</strong>
        <button
          type="button"
          className={`chip chip--sm ${sync && sync.bar ? 'is-on' : ''}`}
          onClick={() => send(ALL_LOOPERS, CMD.DRUM_SYNC)}
        >
          {sync && sync.bar ? `Alla bar ${sync.bar}… (tocca per annullare)` : 'Rimettila a tempo'}
        </button>
        <span className="muted">anche tenendo premuto Drum</span>
      </div>
      {!vst && <div className="drumbox__row">
        <span>Dopo un buco audio di REAPER</span>
        <button type="button" className={`chip chip--sm ${auto ? 'is-on' : ''}`} onClick={() => setSync(1, plen)}>
          Rimettila da sola
        </button>
        <button type="button" className={`chip chip--sm ${!auto ? 'is-on' : ''}`} onClick={() => setSync(0, plen)}>
          Solo a mano
        </button>
      </div>}
      <div className="drumbox__row">
        <span>Il pattern della drum dura</span>
        {[1, 2, 4, 8].map((b) => (
          <button key={b} type="button" className={`chip chip--sm ${plen === b ? 'is-on' : ''}`} onClick={() => setSync(auto, b)}>
            {b} bar
          </button>
        ))}
      </div>
      {sync && (
        <div className="muted">
          {vst ? '' : `Buchi audio visti: ${sync.x} · `}rimessa a tempo: {sync.n}
          {sync.miss ? ` · non partite: ${sync.miss}` : ''}
          {!sync.out && !vst ? ' · manca l\'uscita MIDI della traccia drum verso la UNO' : ''}
        </div>
      )}
      <div className="drumbox__row">
        <strong>Drum machine</strong>
        <span className="muted">
          {!uno ? '' : uno.api === 0 ? 'REAPER troppo vecchio per mandare i pattern'
            : uno.dev >= 0 ? `uscita MIDI: ${uno.name}`
            : `UNO Drum non trovata tra le uscite MIDI di ${vst ? 'Windows' : 'REAPER'}`}
          {uno && uno.last > 0 ? ` · ultimo pattern ${uno.last}` : ''}
          {uno && uno.route && !vst ? ` (${uno.route === 'gate' ? 'dal gate della traccia drum' : 'diretto'})` : ''}
          {gate ? ' · gate per gli stacchi ok' : ''}
        </span>
      </div>
      {uno && uno.err ? <div className="show-warn">{uno.err}</div> : null}
      <div className="drumbox__row">
        <span>Prova un pattern</span>
        <input
          className="show-name drumbox__num"
          type="number"
          min="1"
          max="100"
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
        />
        <button type="button" className="chip chip--sm" onClick={() => send(ALL_LOOPERS, CMD.UNO_PATTERN, n)}>
          Vai adesso
        </button>
      </div>
      <div className="drumbox__row">
        <span>Numerazione</span>
        <button type="button" className={`chip chip--sm ${ofs === 0 ? 'is-on' : ''}`} onClick={() => set(0, lead)}>
          Normale
        </button>
        <button type="button" className={`chip chip--sm ${ofs === 1 ? 'is-on' : ''}`} onClick={() => set(1, lead)}>
          −1 (se va a quello dopo)
        </button>
      </div>
      <div className="drumbox__row">
        <span>Quando mandare il cambio</span>
        {LEADS.map((x) => (
          <button
            key={x.v}
            type="button"
            className={`chip chip--sm ${lead === x.v ? 'is-on' : ''}`}
            onClick={() => set(ofs, x.v)}
          >
            {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Synth: i suoni salvati (preset di REAPER del plugin), caricarli e salvarne di nuovi
function SynthBox({ synth, send, vst }) {
  const [del, setDel] = useState(false);
  if (!synth || !synth.ok) {
    return (
      <div className="drumbox">
        <span className="muted">
          {vst ? 'Il cambio suono del synth funziona solo in REAPER: in Ableton cambialo dal plugin.'
            : 'Non trovo una traccia "synth" con Splice INSTRUMENT o LABS.'}
        </span>
      </div>
    );
  }
  return (
    <div className="drumbox synthbox">
      <div className="drumbox__row">
        <strong>Synth</strong>
        <span className="muted">
          {synth.fx}
          {synth.cur ? ` · ora: ${synth.cur}` : ''}
        </span>
      </div>
      {synth.msg ? <div className="muted">{synth.msg}</div> : null}
      <div className="drumbox__row">
        <button type="button" className="chip chip--sm chip--ok" onClick={() => send(ALL_LOOPERS, CMD.SYNTH_SAVE)}>
          Salva il suono attuale
        </button>
        {synth.list.length > 0 && (
          <button type="button" className={`chip chip--sm ${del ? 'is-on' : ''}`} onClick={() => setDel((d) => !d)}>
            {del ? 'Fatto' : 'Togli suoni'}
          </button>
        )}
      </div>
      <div className="drumbox__row">
        {synth.list.length === 0 && (
          <span className="muted">
            Nessun suono ancora: scegli uno strumento in Splice INSTRUMENT e tocca "Salva il suono attuale".
          </span>
        )}
        {synth.list.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`chip chip--sm ${del ? 'chip--danger' : ''} ${synth.cur === x.name ? 'is-on' : ''}`}
            onClick={() => send(ALL_LOOPERS, del ? CMD.SYNTH_DELETE : CMD.SYNTH_LOAD, x.id)}
          >
            {del ? '✕ ' : ''}
            {x.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const DRAFT_KEY = 'mylooper.show.draft';
function loadDraft() {
  try {
    const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
    return d && d.show && Array.isArray(d.show.events) ? d : null;
  } catch {
    return null;
  }
}
function saveDraft(d) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // niente spazio o storage bloccato: pazienza, resta in memoria
  }
}

export default function ShowPanel({ state, send, client, onClose }) {
  const vst = state?.host === 'vst3';   // the VST3 plug-in (Ableton): no tempo / synth / transport from here
  const loopers = useMemo(() => state?.loopers || [], [state]);
  const machines = useMemo(() => state?.machines || [], [state]);
  const live = state?.show;
  // la scaletta nell'editor sopravvive a chiusura del pannello e ricarica della pagina
  const [show, setShow] = useState(() => loadDraft()?.show || { name: 'Scaletta 1', bars: 32, tempo: 0, events: [] });
  // modifiche annullabili (aggiungi, togli, cancella selezione, incolla, unisci)
  const hist = useRef([]);
  const [histN, setHistN] = useState(0);
  const edit = useCallback((fn) => {
    setShow((prev) => {
      hist.current.push(prev);
      if (hist.current.length > 60) hist.current.shift();
      return fn(prev);
    });
    setHistN(hist.current.length);
  }, []);
  const undo = useCallback(() => {
    const prev = hist.current.pop();
    if (prev) setShow(prev);
    setHistN(hist.current.length);
  }, []);
  // selezione a rettangolo, appunti, partenza da una bar
  const [sel, setSel] = useState(null);          // { r0, b0, r1, b1 } (indici di riga, bar)
  const [selMode, setSelMode] = useState(false);
  const [clip, setClip] = useState(null);        // { items: [{...evento, dbar}], w }
  const [pasteMode, setPasteMode] = useState(false);
  const [startFrom, setStartFrom] = useState(null);
  const drag = useRef(null);
  const skipClick = useRef(false);
  const [extraRows, setExtraRows] = useState(() => loadDraft()?.extraRows || []);
  useEffect(() => saveDraft({ show, extraRows }), [show, extraRows]);
  // se in REAPER sta suonando una scaletta, l'editor mostra quella (es. dopo una ricarica
  // della pagina, o se l'iPad aveva un'altra scaletta aperta)
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !live || !live.st || !client || !client.getShow) return;
    synced.current = true;
    client
      .getShow()
      .then((text) => {
        const sh = parseShow(text);
        if (sh && serializeShow(sh) !== serializeShow(show)) {
          setShow(sh);
          setExtraRows([]);
          setBusy(`Aperta "${sh.name}", quella che sta suonando`);
          setTimeout(() => setBusy(''), 3000);
        }
      })
      .catch(() => {});
  }, [live, client, show]);
  const [pick, setPick] = useState(null);     // { key, bar, l, s, step, t }
  const [addRow, setAddRow] = useState(false);
  const [saveTo, setSaveTo] = useState(false);
  const [busy, setBusy] = useState('');
  const [drumOpen, setDrumOpen] = useState(false);
  const [synthOpen, setSynthOpen] = useState(false);
  const [merge, setMerge] = useState(null);   // { slot, where: 'before' | 'after', from }
  // dopo Salva: controlla che nel file ci siano davvero tutti gli eventi
  const [saveCheck, setSaveCheck] = useState(null);
  useEffect(() => {
    if (!saveCheck) return undefined;
    const sl = (live?.slots || []).find((x) => x.slot === saveCheck.slot);
    if (sl && sl.n === saveCheck.n) {
      setBusy(`Salvata · ${saveCheck.n} eventi`);
      setSaveCheck(null);
      const t = setTimeout(() => setBusy(''), 2500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setBusy('⚠ Non salvata del tutto: riprova');
      setSaveCheck(null);
    }, 4000 - Math.min(3500, Date.now() - saveCheck.t));
    return () => clearTimeout(t);
  }, [live, saveCheck]);
  const synthList = state?.synth?.list || [];
  // ottavi in una bar (4/4 = 8, 3/4 e 6/8 = 6)
  const barEighths = useMemo(() => {
    const l = loopers[0];
    const n = l?.tsNum || 4;
    const d = l?.tsDenom || 4;
    return Math.max(2, Math.round((n * 8) / d));
  }, [loopers]);

  // send the scaletta to REAPER, then do something with it
  const push = useCallback(
    async (code, arg = 0) => {
      try {
        if (client && client.setShow) {
          await client.setShow(serializeShow(show));
          send(ALL_LOOPERS, CMD.SHOW_SET);
        }
        if (code) send(ALL_LOOPERS, code, arg);
      } catch {
        setBusy(vst ? 'Non riesco a mandarla al plugin' : 'Non riesco a mandarla a REAPER');
        setTimeout(() => setBusy(''), 2500);
      }
    },
    [client, send, show, vst]
  );

  // Unisci: carica l'altra scaletta dal disco e la mette prima o dopo questa, nell'editor
  // (poi la salvi dove vuoi)
  const doMerge = useCallback(
    (m) => {
      send(ALL_LOOPERS, CMD.SHOW_LOAD, m.slot);
      setBusy('Unisco…');
      setTimeout(async () => {
        try {
          const other = parseShow(client && client.getShow ? await client.getShow() : '');
          if (!other) {
            setBusy('Quella scaletta è vuota');
          } else {
            edit((cur) => mergeShows(cur, other, m.where, m.where === 'after' ? m.from : null));
            setBusy(`Unita "${other.name}" ${m.where === 'before' ? 'prima' : `dalla bar ${m.from}`}: ricordati di salvare`);
          }
        } catch {
          setBusy('Non riesco a leggerla');
        }
        setTimeout(() => setBusy(''), 4000);
      }, 350);
    },
    [client, send, edit]
  );

  const loadSlot = useCallback(
    async (slot) => {
      send(ALL_LOOPERS, CMD.SHOW_LOAD, slot);
      setBusy('Carico…');
      setTimeout(async () => {
        try {
          const text = client && client.getShow ? await client.getShow() : '';
          const sh = parseShow(text);
          if (sh) {
            setShow(sh);
            setExtraRows([]);
            setBusy('');
          } else setBusy('Slot vuoto');
        } catch {
          setBusy('Non riesco a leggerla');
        }
        setTimeout(() => setBusy(''), 2000);
      }, 350);
    },
    [client, send]
  );

  // rows: general + everything the events touch + what the user added
  const rows = useMemo(() => {
    const seen = new Map();
    seen.set(GEN, { key: GEN, l: 0, s: -1, label: 'Generale', color: 'var(--muted)' });
    const add = (l, s) => {
      const k = rowKey(l, s);
      if (seen.has(k)) return;
      const lp = loopers.find((x) => x.id === l);
      const recBars = lp ? Math.max(1, Math.round(lp.beats / (lp.tsNum || 4))) : 1;
      seen.set(k, {
        key: k,
        l,
        s,
        recBars,
        label: `${lp ? lp.name : 'Strumento ' + l}${s >= 0 ? ' ' + (s + 1) : ' · tutto'}`,
        color: lp?.color || 'var(--accent)',
      });
    };
    const addMachine = (id) => {
      const k = rowKey(MACHINE_ROW, id);
      if (seen.has(k)) return;
      const m = machines.find((x) => x.id === id);
      seen.set(k, { key: k, l: MACHINE_ROW, s: id, label: m ? m.name : `Macchina ${id}`, color: '#f59e0b', machine: true });
    };
    show.events.forEach((e) => (e.l === MACHINE_ROW ? addMachine(e.s) : e.l > 0 && add(e.l, e.s)));
    extraRows.forEach((r) => (r.l === MACHINE_ROW ? addMachine(r.s) : add(r.l, r.s)));
    return [...seen.values()];
  }, [show.events, extraRows, loopers, machines]);

  const bars = Math.max(4, Math.min(256, show.bars || 32));
  const barList = useMemo(() => Array.from({ length: bars }, (_, i) => i + 1), [bars]);
  const byCell = useMemo(() => {
    const m = new Map();
    show.events.forEach((e, i) => {
      const k = `${rowKey(e.l, e.s)}@${e.bar}`;
      const arr = m.get(k) || [];
      arr.push({ ...e, i });
      m.set(k, arr);
    });
    return m;
  }, [show.events]);

  const addEvent = (row, bar, t, v = 0) => {
    edit((sh) => ({
      ...sh,
      events: [...sh.events, { bar, t, l: row.l, s: row.s, v }],
      bars: Math.max(sh.bars, bar),
    }));
    setPick(null);
  };
  const removeEvent = (i) => {
    edit((sh) => ({ ...sh, events: sh.events.filter((_, k) => k !== i) }));
    setPick(null);
  };

  // ---------- selezione, copia / taglia / incolla / cancella ----------
  const rowIndex = useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => m.set(r.key, i));
    return m;
  }, [rows]);
  const selBox = sel && {
    r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1),
    b0: Math.min(sel.b0, sel.b1), b1: Math.max(sel.b0, sel.b1),
  };
  const inBox = (e, box) => {
    const r = rowIndex.get(rowKey(e.l, e.s));
    return r !== undefined && r >= box.r0 && r <= box.r1 && e.bar >= box.b0 && e.bar <= box.b1;
  };
  const selEvents = selBox ? show.events.filter((e) => inBox(e, selBox)) : [];
  const deleteSel = () => {
    if (!selBox) return;
    edit((sh) => ({ ...sh, events: sh.events.filter((e) => !inBox(e, selBox)) }));
  };
  const copySel = () => {
    if (!selBox) return;
    setClip({ items: selEvents.map((e) => ({ ...e, dbar: e.bar - selBox.b0 })), w: selBox.b1 - selBox.b0 + 1 });
  };
  const pasteAt = (bar) => {
    if (!clip) return;
    edit((sh) => {
      const add = clip.items.map(({ dbar, ...e }) => ({ ...e, bar: bar + dbar }));
      const same = (a, b) => a.bar === b.bar && a.t === b.t && a.l === b.l && a.s === b.s && a.v === b.v;
      const events = [...sh.events, ...add.filter((a) => !sh.events.some((e) => same(a, e)))];
      return { ...sh, events, bars: Math.min(256, Math.max(sh.bars, bar + clip.w - 1)) };
    });
    const rs = clip.items.map((e) => rowIndex.get(rowKey(e.l, e.s))).filter((r) => r !== undefined);
    if (rs.length) setSel({ r0: Math.min(...rs), r1: Math.max(...rs), b0: bar, b1: bar + clip.w - 1 });
    setPasteMode(false);
  };
  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest && el.closest('[data-cell]');
    return c ? { r: Number(c.dataset.r), b: Number(c.dataset.b) } : null;
  };
  // trascinare: col mouse sempre, col dito solo in modalita' "Seleziona" (se no scorre)
  const onCellDown = (e, r, b) => {
    if (pasteMode) return;
    const mouse = e.pointerType === 'mouse';
    if (!selMode && !mouse) return;
    if (mouse && e.button !== 0) return;
    drag.current = { r, b, moved: false };
    if (selMode) setSel({ r0: r, b0: b, r1: r, b1: b });
    const move = (ev) => {
      const d = drag.current;
      const c = cellAt(ev.clientX, ev.clientY);
      if (!d || !c) return;
      if (c.r !== d.r || c.b !== d.b) d.moved = true;
      if (d.moved || selMode) setSel({ r0: d.r, b0: d.b, r1: c.r, b1: c.b });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (drag.current && (drag.current.moved || selMode)) {
        // ignora il click che segue questo trascinamento (se il click non arriva, dimentica)
        skipClick.current = true;
        setTimeout(() => {
          skipClick.current = false;
        }, 60);
      }
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onCellClick = (row, b, evs) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (pasteMode) {
      pasteAt(b);
      return;
    }
    setSel(null);
    setPick({ row, bar: b, evs });
  };

  // tastiera: Canc cancella, Cmd/Ctrl + C X V Z, Esc toglie la selezione
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selBox) {
        e.preventDefault();
        deleteSel();
      } else if (e.key === 'Escape') {
        setSel(null);
        setPasteMode(false);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (mod && e.key.toLowerCase() === 'c' && selBox) {
        copySel();
      } else if (mod && e.key.toLowerCase() === 'x' && selBox) {
        copySel();
        deleteSel();
      } else if (mod && e.key.toLowerCase() === 'v' && clip) {
        pasteAt(selBox ? selBox.b0 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const running = live && live.st > 0;
  const waiting = live && live.st === 2;
  const curBar = live ? live.bar : 0;

  // in esecuzione, tieni la bar corrente in vista
  useEffect(() => {
    if (!running) return;
    const el = document.querySelector('.showgrid__col.is-now');
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [curBar, running]);

  // quanto dura una rec della scaletta: fino al play / pausa dopo, sulla stessa sezione
  const recLenLabel = (e) => {
    const next = show.events
      .filter(
        (f) =>
          f.bar > e.bar && f.l === e.l &&
          ((f.s === e.s && (f.t === EV.PLAY || f.t === EV.PAUSE)) ||
            (f.s < 0 && (f.t === EV.PLAY_ALL || f.t === EV.STOP_ALL)))
      )
      .sort((a, b) => a.bar - b.bar)[0];
    if (!next) return 'lunga quanto la rec dello strumento';
    const n = next.bar - e.bar;
    return `${n} bar (fino alla bar ${next.bar})`;
  };

  const actionsFor = (row) =>
    row.machine ? MACH_ACTIONS
    : row.key === GEN ? GEN_ACTIONS.filter((t) => !vst || t !== EV.SYNTH)
    : row.s >= 0 ? SEC_ACTIONS : LOOP_ACTIONS;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet--show" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <h2 className="sheet__title">Scaletta</h2>
          <button type="button" className="chip" onClick={onClose}>
            Chiudi
          </button>
        </div>

        {/* trasporto della scaletta */}
        <div className="show-run">
          {!running ? (
            <button type="button" className="big-btn big-btn--play" onClick={() => push(CMD.SHOW_START, startFrom || 0)}>
              <span className="big-btn__icon">▶</span>
              <span>{startFrom ? `Avvia dalla bar ${startFrom}` : 'Avvia'}</span>
            </button>
          ) : (
            <button type="button" className="big-btn big-btn--stop" onClick={() => send(ALL_LOOPERS, CMD.SHOW_STOP)}>
              <span className="big-btn__icon">■</span>
              <span>Ferma</span>
            </button>
          )}
          {running && !waiting && (
            <button type="button" className="big-btn big-btn--back" onClick={() => send(ALL_LOOPERS, CMD.SHOW_BACK)}>
              <span className="big-btn__icon">↶</span>
              <span>Indietro{live.back > 0 ? ` ${live.back}` : ''}</span>
            </button>
          )}
          {waiting && (
            <button
              type="button"
              className="big-btn big-btn--wait"
              onClick={() => send(ALL_LOOPERS, CMD.SHOW_CONTINUE)}
            >
              <span className="big-btn__icon">⏭</span>
              <span>Continua</span>
            </button>
          )}
          {state?.drums && state.drums.n > 0 && (
            <button
              type="button"
              className={`chip show-run__drum ${state.drums.mute ? 'is-off' : ''} ${state.drums.pend >= 0 ? 'is-pending' : ''}`}
              onClick={() => send(ALL_LOOPERS, CMD.DRUMS)}
              title="Drum machine in pausa / in play (a fine bar)"
            >
              {state.drums.mute ? '▶' : '❚❚'} Drum
            </button>
          )}
          <HoldButton
            ms={1000}
            className="chip chip--danger show-run__clear"
            onHold={() => send(ALL_LOOPERS, CMD.CLEAR_ALL)}
          >
            Svuota tutto <small>(tieni premuto)</small>
          </HoldButton>
          <div className="show-run__info">
            {running ? (
              <>
                <strong>bar {curBar}</strong>
                <span className="muted">
                  {waiting ? ' · in attesa, tocca Continua' : live.back > 0 ? ` · rifà dalla bar ${curBar + 1}`
                    : live.next ? ` · prossimo: ${live.next}` : ''}
                </span>
              </>
            ) : (
              <span className="muted">
                {startFrom ? (
                  <>
                    Parte dalla bar {startFrom}, con tutto com'è a quel punto{' '}
                    <button type="button" className="chip chip--sm" onClick={() => setStartFrom(null)}>
                      ✕ dall'inizio
                    </button>
                  </>
                ) : (
                  'Parte dalla prossima stanghetta · tocca il numero di una bar per partire da lì'
                )}
              </span>
            )}
          </div>
        </div>

        {live && live.ver > 0 && live.ver < 15 && (
          <div className="show-warn">
            In REAPER è caricato un <strong>JSFX vecchio (v{live.ver})</strong>: chiudi e riapri il progetto per
            ricaricarlo. Finché non lo fai gli stacchi e le transizioni di filtro/EQ non funzionano
            {live.ver < 10 ? ' e gli altri comandi arrivano un filo meno precisi' : ''}.
          </div>
        )}
        {running && (
          <div className="show-dbg muted">
            JSFX v{live.ver} · eventi partiti {live.done}
            {live.book > 0 ? ` · prenotati ${live.book}` : ''}
            {live.fall > 0 ? ` · recuperati ${live.fall}` : ''}
          </div>
        )}

        {/* nome, lunghezza, slot */}
        <div className="show-meta">
          <input
            className="show-name"
            value={show.name}
            onChange={(e) => setShow((sh) => ({ ...sh, name: e.target.value }))}
            placeholder="Nome del pezzo"
          />
          <div className="stepper stepper--sm">
            <button type="button" className="stepper__btn" onClick={() => setShow((sh) => ({ ...sh, bars: Math.max(4, sh.bars - 8) }))}>
              −
            </button>
            <div className="stepper__value">
              <small>lunghezza</small>
              <strong>{bars}</strong>
              <span>bar</span>
            </div>
            <button type="button" className="stepper__btn" onClick={() => setShow((sh) => ({ ...sh, bars: Math.min(256, sh.bars + 8) }))}>
              +
            </button>
          </div>
          <button type="button" className="chip" onClick={() => setSaveTo(true)}>
            Salva
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setShow({ name: 'Scaletta ' + ((live?.slots || []).filter((x) => x.name).length + 1), bars: 32, tempo: 0, events: [] });
              setExtraRows([]);
            }}
          >
            Nuova
          </button>
          <button
            type="button"
            className="chip"
            disabled={running}
            onClick={() => setMerge({ slot: null, where: 'after', from: (show.bars || 32) + 1 })}
            title={running ? 'Ferma la scaletta per unirne un\'altra' : 'Metti un\'altra scaletta prima o dopo questa'}
          >
            Unisci
          </button>
          {busy && <span className="muted">{busy}</span>}
        </div>

        <div className="show-slots">
          {(live?.slots || []).map((sl) => (
            <button
              key={sl.slot}
              type="button"
              className={`chip ${sl.name ? '' : 'is-empty'}`}
              onClick={() => (sl.name ? loadSlot(sl.slot) : setSaveTo(true))}
              title={sl.name ? `Carica ${sl.name}` : 'Slot vuoto'}
            >
              <strong>{sl.slot}</strong> {sl.name || '—'}
              {sl.name ? <small> · {sl.n} ev</small> : null}
            </button>
          ))}
        </div>

        {/* strumenti di composizione */}
        <div className="show-tools">
          {/* sempre gli stessi pulsanti (spenti se non servono): la griglia non si sposta mentre trascini */}
          <button type="button" className={`chip chip--sm ${selMode ? 'is-on' : ''}`} onClick={() => setSelMode((m) => !m)}>
            ⬚ Seleziona
          </button>
          <span className="muted show-tools__count">
            {selBox ? `${selEvents.length} eventi · ${selBox.b1 - selBox.b0 + 1} bar` : 'niente selezionato'}
          </span>
          <button type="button" className="chip chip--sm" disabled={!selBox} onClick={copySel}>
            Copia
          </button>
          <button
            type="button"
            className="chip chip--sm"
            disabled={!selBox}
            onClick={() => {
              copySel();
              deleteSel();
            }}
          >
            Taglia
          </button>
          <button type="button" className="chip chip--sm chip--danger" disabled={!selBox} onClick={deleteSel}>
            Cancella
          </button>
          <button
            type="button"
            className={`chip chip--sm ${pasteMode ? 'is-on' : ''}`}
            disabled={!clip}
            onClick={() => setPasteMode((m) => !m)}
          >
            {pasteMode ? 'Tocca la bar dove incollare' : `Incolla${clip ? ` (${clip.items.length})` : ''}`}
          </button>
          <button type="button" className="chip chip--sm show-tools__undo" disabled={!histN} onClick={undo}>
            ↶ Annulla
          </button>
        </div>

        {/* la griglia */}
        <div className={`showgrid ${selMode ? 'is-selecting' : ''} ${pasteMode ? 'is-pasting' : ''}`}>
          <div className="showgrid__head">
            <div className="showgrid__rowlabel" />
            {barList.map((b) => (
              <div
                key={b}
                className={`showgrid__col ${b === curBar && running ? 'is-now' : ''} ${b === startFrom ? 'is-start' : ''}`}
                onClick={() => !running && setStartFrom(b === startFrom || b === 1 ? null : b)}
                title="Parti da questa bar"
              >
                {b % 4 === 1 || bars <= 16 || b === startFrom ? b : ''}
              </div>
            ))}
          </div>
          {rows.map((row, ri) => (
            <div className="showgrid__row" key={row.key} style={{ '--track': row.color }}>
              <div className="showgrid__rowlabel">{row.label}</div>
              {barList.map((b) => {
                const evs = byCell.get(`${row.key}@${b}`) || [];
                const isSel = selBox && ri >= selBox.r0 && ri <= selBox.r1 && b >= selBox.b0 && b <= selBox.b1;
                return (
                  <button
                    key={b}
                    type="button"
                    data-cell="1"
                    data-r={ri}
                    data-b={b}
                    className={`showgrid__cell ${evs.length ? 'has-ev' : ''} ${
                      b === curBar && running ? 'is-now' : ''
                    } ${isSel ? 'is-sel' : ''} ${b === startFrom ? 'is-start' : ''}`}
                    onPointerDown={(e) => onCellDown(e, ri, b)}
                    onClick={() => onCellClick(row, b, evs)}
                  >
                    {evs.map((e) => (
                      <span key={e.i} className={`showev showev--${EV_INFO[e.t]?.cls}`}>
                        {e.t === EV.PATTERN ? `P${e.v}` : e.t === EV.MACHINE_RUN ? (e.v ? '▶M' : '■M')
                          : e.t === EV.DRUMS && e.l === MACHINE_ROW ? (e.v ? 'ON' : 'OFF') : EV_INFO[e.t]?.icon}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          ))}
          <button type="button" className="chip chip--addrow" onClick={() => setAddRow(true)}>
            + riga
          </button>
        </div>

        <div className="show-legend">
          <span className="muted">Tocca una casella per decidere cosa succede a quella bar.</span>
          {[EV.REC, EV.PLAY, EV.PAUSE, EV.CLEAR, EV.STACCO, EV.FADE_IN, EV.FADE_OUT, EV.PATTERN, vst ? EV.MACHINE_RUN : EV.SYNTH, EV.WAIT].map((t) => (
            <span key={t} className="show-legend__item">
              <span className={`showev showev--${EV_INFO[t].cls}`}>{EV_INFO[t].icon}</span>
              {EV_INFO[t].label}
            </span>
          ))}
        </div>

        <button type="button" className={`chip chip--sm drumbox__toggle ${drumOpen ? 'is-on' : ''}`} onClick={() => setDrumOpen((o) => !o)}>
          {vst ? 'Macchine e Ableton' : 'Drum machine'} {drumOpen ? '▴' : '▾'}
        </button>
        <button type="button" className={`chip chip--sm drumbox__toggle ${synthOpen ? 'is-on' : ''}`} onClick={() => setSynthOpen((o) => !o)}>
          Synth {synthOpen ? '▴' : '▾'}
        </button>
        {drumOpen && !vst && <DrumBox uno={state?.drums?.uno} gate={state?.drums?.gate} sync={state?.drums?.sync} send={send} vst={vst} />}
        {drumOpen && vst && <MachinesBox state={state} send={send} client={client} />}
        {synthOpen && <SynthBox synth={state?.synth} send={send} vst={vst} />}

        {/* scelta dell'azione per una casella */}
        {pick && (
          <EventPicker
            row={pick.row}
            barLabel={`bar ${pick.bar}`}
            evs={pick.evs}
            actions={actionsFor(pick.row)}
            gen={pick.row.key === GEN}
            onAdd={(t, v) => addEvent(pick.row, pick.bar, t, v)}
            onRemove={(e) => removeEvent(e.i)}
            onClose={() => setPick(null)}
            barEighths={barEighths}
            synthList={synthList}
            machines={machines}
            state={state}
            send={send}
            vst={vst}
            recLenLabel={recLenLabel}
          />
        )}
        {/* aggiungere una riga */}
        {addRow && (
          <div className="show-pick" onClick={() => setAddRow(false)}>
            <div className="show-pick__box" onClick={(e) => e.stopPropagation()}>
              <div className="show-pick__head">
                <strong>Aggiungi una riga</strong>
              </div>
              <div className="show-pick__grid">
                {machines.map((m) => (
                  <button
                    key={`m${m.id}`}
                    type="button"
                    className="chip chip--sec"
                    style={{ '--track': '#f59e0b' }}
                    onClick={() => {
                      setExtraRows((r) => [...r, { l: MACHINE_ROW, s: m.id }]);
                      setAddRow(false);
                    }}
                  >
                    {m.name}
                  </button>
                ))}
                {loopers.map((l) => (
                  <button
                    key={`l${l.id}`}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setExtraRows((r) => [...r, { l: l.id, s: -1 }]);
                      setAddRow(false);
                    }}
                  >
                    {l.name} · tutto
                  </button>
                ))}
                {loopers.map((l) =>
                  Array.from({ length: 8 }, (_, i) => (
                    <button
                      key={`l${l.id}s${i}`}
                      type="button"
                      className="chip chip--sec"
                      style={{ '--track': l.color || 'var(--accent)' }}
                      onClick={() => {
                        setExtraRows((r) => [...r, { l: l.id, s: i }]);
                        setAddRow(false);
                      }}
                    >
                      {l.name} {i + 1}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* unire un'altra scaletta */}
        {merge && (
          <div className="show-pick" onClick={() => setMerge(null)}>
            <div className="show-pick__box" onClick={(e) => e.stopPropagation()}>
              <div className="show-pick__head">
                <strong>Unisci a "{show.name}"</strong>
                <span className="muted"> · adesso è lunga {show.bars} bar</span>
              </div>
              <div className="stc__label">Quale scaletta</div>
              <div className="show-pick__grid">
                {(live?.slots || [])
                  .filter((sl) => sl.name)
                  .map((sl) => (
                    <button
                      key={sl.slot}
                      type="button"
                      className={`chip chip--sm ${merge.slot === sl.slot ? 'is-on' : ''}`}
                      onClick={() => setMerge({ ...merge, slot: sl.slot })}
                    >
                      <strong>{sl.slot}</strong> {sl.name} <small>· {sl.bars} bar</small>
                    </button>
                  ))}
              </div>
              <div className="stc__label">Dove</div>
              <div className="show-pick__grid">
                <button
                  type="button"
                  className={`chip chip--sm ${merge.where === 'before' ? 'is-on' : ''}`}
                  onClick={() => setMerge({ ...merge, where: 'before' })}
                >
                  Prima di questa
                </button>
                <button
                  type="button"
                  className={`chip chip--sm ${merge.where === 'after' ? 'is-on' : ''}`}
                  onClick={() => setMerge({ ...merge, where: 'after' })}
                >
                  Dopo
                </button>
              </div>
              {merge.where === 'after' && (
                <>
                  <div className="stc__label">
                    Dalla bar <span className="muted">· {show.bars + 1} = subito dopo la fine</span>
                  </div>
                  <div className="show-pick__grid">
                    <input
                      className="show-name drumbox__num merge__from"
                      type="number"
                      min="1"
                      max="256"
                      value={merge.from}
                      onChange={(e) => setMerge({ ...merge, from: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    {merge.from <= show.bars && (
                      <span className="muted">si sovrappone alle ultime {show.bars - merge.from + 1} bar</span>
                    )}
                  </div>
                </>
              )}
              <button
                type="button"
                className="chip chip--ok stc__go"
                disabled={!merge.slot}
                onClick={() => {
                  doMerge(merge);
                  setMerge(null);
                }}
              >
                Unisci
              </button>
            </div>
          </div>
        )}

        {/* in quale slot salvare */}
        {saveTo && (
          <div className="show-pick" onClick={() => setSaveTo(false)}>
            <div className="show-pick__box" onClick={(e) => e.stopPropagation()}>
              <div className="show-pick__head">
                <strong>Salva "{show.name}" in…</strong>
              </div>
              <div className="show-pick__grid">
                {(live?.slots || []).map((sl) => (
                  <button
                    key={sl.slot}
                    type="button"
                    className="chip"
                    onClick={() => {
                      push(CMD.SHOW_SAVE, sl.slot);
                      setSaveTo(false);
                      setBusy('Salvo…');
                      setSaveCheck({ slot: sl.slot, n: show.events.length, t: Date.now() });
                    }}
                  >
                    <strong>{sl.slot}</strong> {sl.name || '—'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
