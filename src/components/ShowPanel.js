import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ALL_LOOPERS, CMD, EV, EV_INFO, FADE_STEPS, eighthsLabel, fxEvArg, fxEvParts, parseShow, posLabel, serializeShow, stacArg, stacParts,
} from '../lib/protocol';
import { fadeLabel } from './FadeButton';

// La scaletta: il pezzo scritto prima. Righe = strumenti e sezioni, colonne = bar.
// Tocchi una casella e scegli cosa deve succedere lì; dal vivo premi Avvia e il
// looper fa da solo. Le "attese" tengono tutto fermo finché non tocchi Continua.

const GEN = 'gen';
const rowKey = (l, s) => (l === 0 ? GEN : `${l}:${s}`);

const SEC_ACTIONS = [EV.REC, EV.CUE_REC, EV.PLAY, EV.PAUSE, EV.STACCO, EV.FADE_IN, EV.FADE_OUT, EV.FILTER, EV.EQ_LO, EV.EQ_MID, EV.EQ_HI];
const LOOP_ACTIONS = [EV.PLAY_ALL, EV.STOP_ALL, EV.STACCO, EV.FADE_IN, EV.FADE_OUT, EV.FILTER, EV.EQ_LO, EV.EQ_MID, EV.EQ_HI];
const GEN_ACTIONS = [EV.WAIT, EV.STACCO, EV.DRUMS, EV.PATTERN, EV.SYNTH, EV.TEMPO, EV.FILTER, EV.EQ_LO, EV.EQ_MID, EV.EQ_HI];
const LEADS = [
  { v: 0, label: 'Sulla stanghetta' },
  { v: 1, label: '1/8 prima' },
  { v: 2, label: '1/4 prima' },
  { v: 4, label: '1/2 bar prima' },
];

const FILTER_PRESETS = [
  { v: 0, label: 'Passa-basso tutto' },
  { v: 50, label: 'Passa-basso metà' },
  { v: 100, label: 'Aperto' },
  { v: 150, label: 'Passa-alto metà' },
  { v: 200, label: 'Passa-alto tutto' },
];
const EQ_PRESETS = [
  { v: 0, label: 'Kill' },
  { v: 50, label: 'Giù a metà' },
  { v: 100, label: 'Normale' },
  { v: 150, label: 'Su del 50%' },
];
const DRUM_PRESETS = [
  { v: 0, label: 'Ferma la drum' },
  { v: 1, label: 'Fai partire la drum' },
];

const isFx = (t) => t === EV.FILTER || (t >= EV.EQ_LO && t <= EV.EQ_HI);

function needsValue(t) {
  return t === EV.FADE_IN || t === EV.FADE_OUT || t === EV.FILTER || t === EV.TEMPO ||
    (t >= EV.EQ_LO && t <= EV.EQ_HI) || t === EV.DRUMS || t === EV.PATTERN || t === EV.STACCO || t === EV.SYNTH;
}

function staccoLabel(v, barEighths) {
  const p = stacParts(v);
  return `${eighthsLabel(p.dur, barEighths)} ${posLabel(p.pos)}${p.drum ? ' · anche la drum' : ''}`;
}

// Stacco: da dove parte (gli ottavi della bar) e quanto dura. La musica sotto continua a
// girare, quindi quando finisce tutto riparte esattamente a tempo.
function StaccoPicker({ barEighths, gen, onAdd }) {
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(2);
  const [drum, setDrum] = useState(true);
  const durs = [1, 2, 3, 4, 5, 6, 7].filter((d) => d < barEighths).concat([barEighths, barEighths * 2]);
  const cells = Array.from({ length: barEighths }, (_, i) => i);
  return (
    <div className="stc">
      <div className="stc__label">
        Da dove <span className="muted">· {posLabel(pos)}</span>
      </div>
      <div className="stc__bar" style={{ '--n': barEighths }}>
        {cells.map((i) => (
          <button
            key={i}
            type="button"
            className={`stc__cell ${i % 2 === 0 ? 'is-beat' : ''} ${i >= pos && i < pos + dur ? 'is-on' : ''} ${
              i === pos ? 'is-start' : ''
            }`}
            onClick={() => setPos(i)}
          >
            {i % 2 === 0 ? i / 2 + 1 : 'e'}
          </button>
        ))}
      </div>
      {pos + dur > barEighths && <div className="stc__more muted">…continua nella bar dopo</div>}
      <div className="stc__label">Quanto dura</div>
      <div className="show-pick__grid">
        {durs.map((d) => (
          <button key={d} type="button" className={`chip chip--sm ${d === dur ? 'is-on' : ''}`} onClick={() => setDur(d)}>
            {eighthsLabel(d, barEighths)}
          </button>
        ))}
      </div>
      {gen && (
        <label className="stc__drum">
          <input type="checkbox" checked={drum} onChange={(e) => setDrum(e.target.checked)} />
          Si ferma anche la drum machine
        </label>
      )}
      <button type="button" className="chip chip--ok stc__go" onClick={() => onAdd(stacArg(pos, dur, gen && drum))}>
        Metti lo stacco
      </button>
    </div>
  );
}

// Drum machine: provare un pattern al volo e regolare come arriva il cambio
function DrumBox({ uno, gate, sync, send }) {
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
      <div className="drumbox__row">
        <span>Dopo un buco audio di REAPER</span>
        <button type="button" className={`chip chip--sm ${auto ? 'is-on' : ''}`} onClick={() => setSync(1, plen)}>
          Rimettila da sola
        </button>
        <button type="button" className={`chip chip--sm ${!auto ? 'is-on' : ''}`} onClick={() => setSync(0, plen)}>
          Solo a mano
        </button>
      </div>
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
          Buchi audio visti: {sync.x} · rimessa a tempo: {sync.n}
          {sync.miss ? ` · non partite: ${sync.miss}` : ''}
          {!sync.out ? ' · manca l\'uscita MIDI della traccia drum verso la UNO' : ''}
        </div>
      )}
      <div className="drumbox__row">
        <strong>Drum machine</strong>
        <span className="muted">
          {!uno ? '' : uno.api === 0 ? 'REAPER troppo vecchio per mandare i pattern'
            : uno.dev >= 0 ? `uscita MIDI: ${uno.name}` : 'UNO Drum non trovata tra le uscite MIDI di REAPER'}
          {uno && uno.last > 0 ? ` · ultimo pattern ${uno.last}` : ''}
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
function SynthBox({ synth, send }) {
  const [del, setDel] = useState(false);
  if (!synth || !synth.ok) {
    return (
      <div className="drumbox">
        <span className="muted">Non trovo una traccia "synth" con Splice INSTRUMENT o LABS.</span>
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

function valueLabel(e, barEighths = 8, synthList = []) {
  if (e.t === EV.FADE_IN || e.t === EV.FADE_OUT) return `${fadeLabel(e.v / 2)} bar`;
  if (e.t === EV.FILTER || (e.t >= EV.EQ_LO && e.t <= EV.EQ_HI)) {
    const { val, bars } = fxEvParts(e.v);
    const base = e.t === EV.FILTER
      ? (FILTER_PRESETS.find((p) => p.v === val) || {}).label || `${val}`
      : (EQ_PRESETS.find((p) => p.v === val) || {}).label || `${val}%`;
    return `${base} · ${bars > 0 ? `in ${fadeLabel(bars)} bar` : 'subito'}`;
  }
  if (e.t === EV.DRUMS) return e.v ? 'in play' : 'in pausa';
  if (e.t === EV.TEMPO) return `${Math.round(e.v / 100)} BPM`;
  if (e.t === EV.PATTERN) return `pattern ${e.v}`;
  if (e.t === EV.STACCO) return staccoLabel(e.v, barEighths);
  if (e.t === EV.SYNTH) return (synthList.find((x) => x.id === e.v) || {}).name || `suono ${e.v} (non c'è più)`;
  return '';
}

export default function ShowPanel({ state, send, client, onClose }) {
  const loopers = useMemo(() => state?.loopers || [], [state]);
  const live = state?.show;
  const [show, setShow] = useState(() => ({ name: 'Scaletta 1', bars: 32, tempo: 0, events: [] }));
  const [extraRows, setExtraRows] = useState([]);
  const [pick, setPick] = useState(null);     // { key, bar, l, s, step, t }
  const [addRow, setAddRow] = useState(false);
  const [saveTo, setSaveTo] = useState(false);
  const [busy, setBusy] = useState('');
  const [drumOpen, setDrumOpen] = useState(false);
  const [synthOpen, setSynthOpen] = useState(false);
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
        setBusy('Non riesco a mandarla a REAPER');
        setTimeout(() => setBusy(''), 2500);
      }
    },
    [client, send, show]
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
    show.events.forEach((e) => e.l > 0 && add(e.l, e.s));
    extraRows.forEach((r) => add(r.l, r.s));
    return [...seen.values()];
  }, [show.events, extraRows, loopers]);

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
    setShow((sh) => ({
      ...sh,
      events: [...sh.events, { bar, t, l: row.l, s: row.s, v }],
      bars: Math.max(sh.bars, bar),
    }));
    setPick(null);
  };
  const removeEvent = (i) => {
    setShow((sh) => ({ ...sh, events: sh.events.filter((_, k) => k !== i) }));
    setPick(null);
  };

  const running = live && live.st > 0;
  const waiting = live && live.st === 2;
  const curBar = live ? live.bar : 0;

  // in esecuzione, tieni la bar corrente in vista
  useEffect(() => {
    if (!running) return;
    const el = document.querySelector('.showgrid__col.is-now');
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [curBar, running]);

  const actionsFor = (row) => (row.key === GEN ? GEN_ACTIONS : row.s >= 0 ? SEC_ACTIONS : LOOP_ACTIONS);
  const presetsFor = (t) =>
    t === EV.FILTER ? FILTER_PRESETS
    : t >= EV.EQ_LO && t <= EV.EQ_HI ? EQ_PRESETS
    : t === EV.DRUMS ? DRUM_PRESETS
    : t === EV.FADE_IN || t === EV.FADE_OUT ? FADE_STEPS.map((b) => ({ v: b * 2, label: `${fadeLabel(b)} bar` }))
    : [];

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
            <button type="button" className="big-btn big-btn--play" onClick={() => push(CMD.SHOW_START)}>
              <span className="big-btn__icon">▶</span>
              <span>Avvia</span>
            </button>
          ) : (
            <button type="button" className="big-btn big-btn--stop" onClick={() => send(ALL_LOOPERS, CMD.SHOW_STOP)}>
              <span className="big-btn__icon">■</span>
              <span>Ferma</span>
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
          <div className="show-run__info">
            {running ? (
              <>
                <strong>bar {curBar}</strong>
                <span className="muted">
                  {waiting ? ' · in attesa, tocca Continua' : live.next ? ` · prossimo: ${live.next}` : ''}
                </span>
              </>
            ) : (
              <span className="muted">Parte dalla prossima stanghetta</span>
            )}
          </div>
        </div>

        {live && live.ver > 0 && live.ver < 12 && (
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

        {/* la griglia */}
        <div className="showgrid">
          <div className="showgrid__head">
            <div className="showgrid__rowlabel" />
            {barList.map((b) => (
              <div key={b} className={`showgrid__col ${b === curBar && running ? 'is-now' : ''}`}>
                {b % 4 === 1 || bars <= 16 ? b : ''}
              </div>
            ))}
          </div>
          {rows.map((row) => (
            <div className="showgrid__row" key={row.key} style={{ '--track': row.color }}>
              <div className="showgrid__rowlabel">{row.label}</div>
              {barList.map((b) => {
                const evs = byCell.get(`${row.key}@${b}`) || [];
                return (
                  <button
                    key={b}
                    type="button"
                    className={`showgrid__cell ${evs.length ? 'has-ev' : ''} ${
                      b === curBar && running ? 'is-now' : ''
                    }`}
                    onClick={() => setPick({ row, bar: b, evs })}
                  >
                    {evs.map((e) => (
                      <span key={e.i} className={`showev showev--${EV_INFO[e.t]?.cls}`}>
                        {e.t === EV.PATTERN ? `P${e.v}` : EV_INFO[e.t]?.icon}
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
          {[EV.REC, EV.PLAY, EV.PAUSE, EV.STACCO, EV.FADE_IN, EV.FADE_OUT, EV.PATTERN, EV.SYNTH, EV.WAIT].map((t) => (
            <span key={t} className="show-legend__item">
              <span className={`showev showev--${EV_INFO[t].cls}`}>{EV_INFO[t].icon}</span>
              {EV_INFO[t].label}
            </span>
          ))}
        </div>

        <button type="button" className={`chip chip--sm drumbox__toggle ${drumOpen ? 'is-on' : ''}`} onClick={() => setDrumOpen((o) => !o)}>
          Drum machine {drumOpen ? '▴' : '▾'}
        </button>
        <button type="button" className={`chip chip--sm drumbox__toggle ${synthOpen ? 'is-on' : ''}`} onClick={() => setSynthOpen((o) => !o)}>
          Synth {synthOpen ? '▴' : '▾'}
        </button>
        {drumOpen && <DrumBox uno={state?.drums?.uno} gate={state?.drums?.gate} sync={state?.drums?.sync} send={send} />}
        {synthOpen && <SynthBox synth={state?.synth} send={send} />}

        {/* scelta dell'azione per una casella */}
        {pick && (
          <div className="show-pick" onClick={() => setPick(null)}>
            <div className="show-pick__box" onClick={(e) => e.stopPropagation()}>
              <div className="show-pick__head">
                <strong>{pick.row.label}</strong>
                <span className="muted"> · bar {pick.bar}</span>
              </div>

              {pick.evs.length > 0 && (
                <div className="show-pick__list">
                  {pick.evs.map((e) => (
                    <div className="show-pick__ev" key={e.i}>
                      <span className={`showev showev--${EV_INFO[e.t]?.cls}`}>{EV_INFO[e.t]?.icon}</span>
                      {EV_INFO[e.t]?.label}
                      {needsValue(e.t) && <small> · {valueLabel(e, barEighths, synthList)}</small>}
                      <button type="button" className="chip chip--danger" onClick={() => removeEvent(e.i)}>
                        Togli
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!pick.t ? (
                <>
                  <div className="show-pick__grid">
                    {actionsFor(pick.row).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`chip showev-btn showev-btn--${EV_INFO[t].cls}`}
                        onClick={() => (needsValue(t) ? setPick({ ...pick, t }) : addEvent(pick.row, pick.bar, t))}
                      >
                        <span className={`showev showev--${EV_INFO[t].cls}`}>{EV_INFO[t].icon}</span>
                        {EV_INFO[t].label}
                      </button>
                    ))}
                  </div>
                </>
              ) : pick.t === EV.STACCO ? (
                <StaccoPicker
                  barEighths={barEighths}
                  gen={pick.row.key === GEN}
                  onAdd={(v) => addEvent(pick.row, pick.bar, EV.STACCO, v)}
                />
              ) : pick.t === EV.SYNTH ? (
                <div className="show-pick__grid">
                  {synthList.length === 0 && (
                    <span className="muted">
                      Ancora nessun suono salvato: apri "Synth" sotto la griglia e salva i suoni che usi.
                    </span>
                  )}
                  {synthList.map((x) => (
                    <button key={x.id} type="button" className="chip" onClick={() => addEvent(pick.row, pick.bar, EV.SYNTH, x.id)}>
                      {x.name}
                    </button>
                  ))}
                </div>
              ) : pick.t === EV.PATTERN ? (
                <div className="show-pick__grid">
                  <input
                    className="show-name drumbox__num"
                    type="number"
                    min="1"
                    max="100"
                    defaultValue={state?.drums?.uno?.last || 1}
                    id="show-pat"
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      addEvent(pick.row, pick.bar, EV.PATTERN, Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                    }
                  />
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      addEvent(
                        pick.row,
                        pick.bar,
                        EV.PATTERN,
                        Math.max(1, Math.min(100, Number(document.getElementById('show-pat').value) || 1))
                      )
                    }
                  >
                    Vai a questo pattern
                  </button>
                  <button
                    type="button"
                    className="chip chip--sm"
                    onClick={() => send(ALL_LOOPERS, CMD.UNO_PATTERN, Number(document.getElementById('show-pat').value) || 1)}
                  >
                    Provalo adesso
                  </button>
                </div>
              ) : pick.t === EV.TEMPO ? (
                <div className="show-pick__grid">
                  <input
                    className="show-name"
                    type="number"
                    min="20"
                    max="300"
                    defaultValue={Math.round(state?.tempo || 120)}
                    onKeyDown={(e) => e.key === 'Enter' && addEvent(pick.row, pick.bar, EV.TEMPO, Number(e.target.value) * 100)}
                    id="show-bpm"
                  />
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      addEvent(pick.row, pick.bar, EV.TEMPO, Number(document.getElementById('show-bpm').value) * 100)
                    }
                  >
                    Metti questo BPM
                  </button>
                </div>
              ) : isFx(pick.t) && pick.val !== undefined ? (
                <>
                  <div className="stc__label">
                    Transizione <span className="muted">· {pick.valLabel}</span>
                  </div>
                  <div className="show-pick__grid">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => addEvent(pick.row, pick.bar, pick.t, fxEvArg(pick.val, 0))}
                    >
                      Subito
                    </button>
                    {FADE_STEPS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        className="chip"
                        onClick={() => addEvent(pick.row, pick.bar, pick.t, fxEvArg(pick.val, b))}
                      >
                        in {fadeLabel(b)} bar
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="show-pick__grid">
                  {presetsFor(pick.t).map((p) => (
                    <button
                      key={p.v}
                      type="button"
                      className="chip"
                      onClick={() =>
                        isFx(pick.t)
                          ? setPick({ ...pick, val: p.v, valLabel: p.label })
                          : addEvent(pick.row, pick.bar, pick.t, p.v)
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* aggiungere una riga */}
        {addRow && (
          <div className="show-pick" onClick={() => setAddRow(false)}>
            <div className="show-pick__box" onClick={(e) => e.stopPropagation()}>
              <div className="show-pick__head">
                <strong>Aggiungi una riga</strong>
              </div>
              <div className="show-pick__grid">
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
                      setBusy('Salvata');
                      setTimeout(() => setBusy(''), 1500);
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
