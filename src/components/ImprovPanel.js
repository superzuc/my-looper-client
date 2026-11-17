import { useEffect, useMemo, useState } from 'react';
import {
  ALL_LOOPERS, CMD, EV, EV_INFO, IMPROV_BARS, MACHINE_ROW, evKey, parseImprov, serializeImprov,
} from '../lib/protocol';
import HoldButton from './HoldButton';
import { EventPicker, GEN_ACTIONS, LOOP_ACTIONS, MACH_ACTIONS, SEC_ACTIONS } from './ShowParts';

// L'Improv: una scaletta da usare dal vivo, per ispirazione. Mostra sempre le prossime 16
// bar da adesso (scorrono: a destra arrivano quelle nuove) di una traccia, o del Generale
// (drum machine, BPM, stacchi...). Tocchi una casella e scegli l'azione, come nella
// scaletta: succede su quella bar. Funziona anche sopra una scaletta scritta che sta girando.

export default function ImprovPanel({ state, send, client, looperId, onClose }) {
  const vst = state?.host === 'vst3';
  const loopers = useMemo(() => state?.loopers || [], [state]);
  const machines = useMemo(() => state?.machines || [], [state]);
  const imp = state?.improv || { now: 0, on: 0, ev: '' };
  const now = imp.now || 0;
  const playing = now > 0;
  const [tab, setTab] = useState(looperId || 0);          // id of the looper, 0 = Generale
  const [pick, setPick] = useState(null);                 // { row, bar, evs }
  const [local, setLocal] = useState(null);               // { ev, at }: sent, the hub doesn't show it yet
  const [err, setErr] = useState('');
  const serverEv = imp.ev || '';
  useEffect(() => {
    if (local && (serverEv === local.ev || Date.now() - local.at > 2000)) setLocal(null);
  }, [serverEv, local]);
  const events = useMemo(() => parseImprov(local ? local.ev : serverEv), [local, serverEv]);

  const looper = loopers.find((l) => l.id === tab);
  const color = looper?.color || 'var(--accent)';
  const rows = useMemo(() => {
    if (tab && looper) {
      return [
        { key: `${tab}:-1`, l: tab, s: -1, label: 'Tutta la traccia', color },
        ...Array.from({ length: 8 }, (_, s) => ({
          key: `${tab}:${s}`, l: tab, s, label: `Sezione ${s + 1}`, color, has: !!looper.sections?.[s]?.has,
        })),
      ];
    }
    const r = [{ key: 'gen', l: 0, s: -1, label: 'Generale', color: 'var(--muted)', gen: true }];
    if (vst) machines.forEach((m) => r.push({ key: `m:${m.id}`, l: MACHINE_ROW, s: m.id, label: m.name, color: '#f59e0b', machine: true }));
    return r;
  }, [tab, looper, color, vst, machines]);

  const bars = Array.from({ length: IMPROV_BARS + 1 }, (_, i) => now + i);   // adesso, +1 ... +16
  const cellEvs = (row, bar) => events.filter((e) => e.bar === bar && e.l === row.l && e.s === row.s);
  const countFor = (l) => events.filter((e) => e.bar >= now && (l === 0 ? e.l <= 0 : e.l === l)).length;

  const barEighths = useMemo(() => {
    const l = looper || loopers[0];
    return Math.max(2, Math.round(((l?.tsNum || 4) * 8) / (l?.tsDenom || 4)));
  }, [looper, loopers]);

  const write = async (list) => {
    const cur = list.filter((e) => e.bar >= now).sort((a, b) => a.bar - b.bar || a.t - b.t);
    setLocal({ ev: cur.map(evKey).join(';'), at: Date.now() });
    try {
      if (client && client.setImprov) await client.setImprov(serializeImprov(cur));
      send(ALL_LOOPERS, CMD.IMPROV_SET);
      setErr('');
    } catch {
      setErr(vst ? 'Non riesco a mandarla al plugin' : 'Non riesco a mandarla a REAPER');
    }
  };
  const add = (row, bar, t, v = 0) => {
    write([...events, { bar, t, l: row.l, s: row.s, v: Math.round(v || 0) }]);
    setPick(null);
  };
  const remove = (e) => {
    const k = evKey(e);
    let gone = false;
    write(events.filter((x) => (gone || evKey(x) !== k ? true : ((gone = true), false))));
    setPick(null);
  };
  const clearAll = () => {
    setLocal({ ev: '', at: Date.now() });
    send(ALL_LOOPERS, CMD.IMPROV_CLEAR);
  };

  const actionsFor = (row) =>
    row.machine ? MACH_ACTIONS
    : row.gen ? GEN_ACTIONS.filter((t) => t !== EV.WAIT && (!vst || t !== EV.SYNTH))
    : row.s >= 0 ? SEC_ACTIONS : LOOP_ACTIONS;
  // una rec dura fino al play / pausa dopo, sulla stessa sezione (come nella scaletta)
  const recLenLabel = (e) => {
    const next = events
      .filter((f) => f.bar > e.bar && f.l === e.l &&
        ((f.s === e.s && (f.t === EV.PLAY || f.t === EV.PAUSE)) || (f.s < 0 && (f.t === EV.PLAY_ALL || f.t === EV.STOP_ALL))))
      .sort((a, b) => a.bar - b.bar)[0];
    return next ? `${next.bar - e.bar} bar` : 'lunga quanto la rec dello strumento';
  };
  const barLabel = (b) => (b === now + 1 ? 'alla prossima bar' : `fra ${b - now} bar`);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet--show sheet--improv" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <div>
            <h2 className="sheet__title">Improv</h2>
            <div className="sheet__sub">
              Le prossime {IMPROV_BARS} bar, dal vivo: tocca una casella e scegli cosa succede in quella bar.
            </div>
          </div>
          <button type="button" className="chip" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="imp-tabs" role="tablist">
          {loopers.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={tab === l.id}
              className={`chip chip--sm ${tab === l.id ? 'is-on' : ''}`}
              style={{ '--track': l.color || 'var(--accent)' }}
              onClick={() => setTab(l.id)}
            >
              {l.name}
              {countFor(l.id) > 0 && <span className="imp-tabs__n">{countFor(l.id)}</span>}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 0}
            className={`chip chip--sm ${tab === 0 ? 'is-on' : ''}`}
            onClick={() => setTab(0)}
          >
            Generale
            {countFor(0) > 0 && <span className="imp-tabs__n">{countFor(0)}</span>}
          </button>
        </div>

        {!playing ? (
          <div className="imp-off">
            Fai partire il trasporto: l&apos;Improv scrive sulle prossime {IMPROV_BARS} bar mentre suona.
          </div>
        ) : (
          <div className="showgrid impgrid">
            <div className="showgrid__head">
              <div className="showgrid__rowlabel">
                <span className="muted">bar {now}</span>
              </div>
              {bars.map((b) => (
                <div key={b} className={`showgrid__col ${b === now ? 'is-now' : ''}`}>
                  {b === now ? 'ora' : `+${b - now}`}
                </div>
              ))}
            </div>
            {rows.map((row) => (
              <div className="showgrid__row" key={row.key} style={{ '--track': row.color }}>
                <div className={`showgrid__rowlabel ${row.s >= 0 && !row.has && !row.gen && !row.machine ? 'is-empty' : ''}`}>
                  {row.label}
                </div>
                {bars.map((b) => {
                  const evs = cellEvs(row, b);
                  const past = b === now;
                  return (
                    <button
                      key={b}
                      type="button"
                      className={`showgrid__cell ${evs.length ? 'has-ev' : ''} ${past ? 'is-now' : ''}`}
                      disabled={past}
                      aria-label={`${row.label}, ${past ? 'adesso' : barLabel(b)}`}
                      onClick={() => setPick({ row, bar: b, evs })}
                    >
                      {evs.slice(0, 2).map((e, i) => (
                        <span key={i} className={`showev showev--${EV_INFO[e.t]?.cls}`}>
                          {EV_INFO[e.t]?.icon}
                        </span>
                      ))}
                      {evs.length > 2 && <small>+{evs.length - 2}</small>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <div className="imp-foot">
          <span className="muted">
            {err || (imp.on ? `${events.filter((e) => e.bar >= now).length} azioni in arrivo` : 'Niente in arrivo')}
          </span>
          {events.length > 0 && (
            <HoldButton ms={600} className="chip chip--danger chip--sm" onHold={clearAll}>
              Svuota tutto
            </HoldButton>
          )}
        </div>

        {pick && (
          <EventPicker
            row={pick.row}
            barLabel={`${barLabel(pick.bar)} (bar ${pick.bar})`}
            evs={cellEvs(pick.row, pick.bar)}
            actions={actionsFor(pick.row)}
            gen={!!pick.row.gen}
            onAdd={(t, v) => add(pick.row, pick.bar, t, v)}
            onRemove={remove}
            onClose={() => setPick(null)}
            barEighths={barEighths}
            synthList={state?.synth?.list || []}
            machines={machines}
            state={state}
            send={send}
            vst={vst}
            recLenLabel={recLenLabel}
          />
        )}
      </div>
    </div>
  );
}
