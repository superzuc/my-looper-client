import { useCallback, useRef } from 'react';
import { ALL_LOOPERS, CMD, eqArg, eqSecArg, filterArg, filterSecArg } from '../lib/protocol';

// Filter + 3 band kill, the two things a DJ uses to get in and out of a track.
// The same panel drives the whole rig, one instrument, or one section.
const BANDS = [
  { key: 'lo', label: 'Bassi' },
  { key: 'mid', label: 'Medi' },
  { key: 'hi', label: 'Alti' },
];

const THROTTLE_MS = 60;

function useThrottled(send) {
  const last = useRef(0);
  const timer = useRef(null);
  const pending = useRef(null);
  return useCallback(
    (target, code, arg) => {
      pending.current = [target, code, arg];
      const now = performance.now();
      const flush = () => {
        last.current = performance.now();
        timer.current = null;
        const p = pending.current;
        if (p) send(p[0], p[1], p[2]);
      };
      if (now - last.current >= THROTTLE_MS) flush();
      else if (!timer.current) timer.current = setTimeout(flush, THROTTLE_MS - (now - last.current));
    },
    [send]
  );
}

export default function FxPanel({ state, send, target, onTarget, onClose }) {
  const push = useThrottled(send);
  const loopers = state?.loopers || [];
  const isAll = target.id === ALL_LOOPERS;
  const looper = loopers.find((l) => l.id === target.id);
  // with "Generale" every looper gets the same values: the first one shows them
  const ref = isAll ? loopers[0] : looper;
  const section = looper && target.s != null ? looper.sections[target.s] : null;

  // what the panel is showing: the rig, one instrument, or one section of it
  const src = section || ref;
  const fx = src
    ? { fil: src.fil || 0, lo: src.lo ?? 1, mid: src.mid ?? 1, hi: src.hi ?? 1 }
    : { fil: 0, lo: 1, mid: 1, hi: 1 };
  const sendFilter = (v) =>
    section
      ? push(target.id, CMD.FILTER_SEC, filterSecArg(target.s, v))
      : push(target.id, CMD.FILTER, filterArg(v));
  const sendEq = (band, g) =>
    section
      ? push(target.id, CMD.EQ_SEC, eqSecArg(target.s, band, g))
      : push(target.id, CMD.EQ, eqArg(band, g));
  const reset = () => send(target.id, CMD.FX_RESET, section ? 1 + target.s : isAll ? 9 : 0);

  const secList = looper ? looper.sections.map((x, i) => (x.has || x.st >= 3 ? i : -1)).filter((i) => i >= 0) : [];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet--fx" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <h2 className="sheet__title">Effetti</h2>
          <button type="button" className="chip" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="fx-target">
          <button
            type="button"
            className={`chip ${isAll ? 'is-on' : ''}`}
            onClick={() => onTarget({ id: ALL_LOOPERS, s: null })}
          >
            Generale
          </button>
          {loopers.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`chip ${target.id === l.id && target.s == null ? 'is-on' : ''}`}
              style={{ '--track': l.color || 'var(--accent)' }}
              onClick={() => onTarget({ id: l.id, s: null })}
            >
              <span className="fx-target__dot" />
              {l.name}
            </button>
          ))}
        </div>

        {!isAll && looper && (
          <div className="fx-target fx-target--sec">
            <span className="fx-target__label">Sezione</span>
            {secList.length === 0 && <span className="muted">— nessuna sezione registrata</span>}
            {secList.map((i) => (
              <button
                key={i}
                type="button"
                className={`chip chip--sec ${target.s === i ? 'is-on' : ''}`}
                onClick={() => onTarget({ id: looper.id, s: target.s === i ? null : i })}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}

        <div className="fx-row">
          <div className="fx-row__head">
            <strong>Filtro</strong>
            <span className="muted">
              {fx.fil < -0.02
                ? `Passa-basso ${Math.round(-fx.fil * 100)}%`
                : fx.fil > 0.02
                ? `Passa-alto ${Math.round(fx.fil * 100)}%`
                : 'Aperto'}
            </span>
          </div>
          <input
            className="fx-slider fx-slider--fil"
            type="range"
            min="-100"
            max="100"
            step="1"
            value={Math.round(fx.fil * 100)}
            onChange={(e) => sendFilter(Number(e.target.value) / 100)}
            onDoubleClick={() => sendFilter(0)}
          />
          <div className="fx-scale">
            <span>basso</span>
            <button type="button" className="fx-center" onClick={() => sendFilter(0)}>
              centro
            </button>
            <span>alto</span>
          </div>
        </div>

        <div className="fx-bands">
          {BANDS.map((b, i) => {
            const g = fx[b.key];
            return (
              <div className="fx-band" key={b.key}>
                <div className="fx-band__label">{b.label}</div>
                <input
                  className="fx-slider fx-slider--band"
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  value={Math.round(g * 100)}
                  onChange={(e) => sendEq(i, Number(e.target.value) / 100)}
                />
                <div className="fx-band__val">{g === 0 ? 'kill' : `${Math.round(g * 100)}%`}</div>
                <button
                  type="button"
                  className={`chip chip--kill2 ${g === 0 ? 'is-on' : ''}`}
                  onClick={() => sendEq(i, g === 0 ? 1 : 0)}
                >
                  Kill
                </button>
              </div>
            );
          })}
        </div>

        <div className="sheet__foot">
          <button type="button" className="chip" onClick={reset}>
            Azzera {section ? `sezione ${target.s + 1}` : isAll ? 'tutto' : looper?.name}
          </button>
          <span className="muted">
            {isAll
              ? 'Agisce su tutti gli strumenti insieme'
              : section
              ? 'Agisce solo su questa sezione'
              : 'Agisce su tutte le sezioni di questo strumento'}
          </span>
        </div>
      </div>
    </div>
  );
}
