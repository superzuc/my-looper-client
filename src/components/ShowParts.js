import { useState } from 'react';
import { CMD, EV, EV_INFO, FADE_STEPS, MACHINE_ROW, eighthsLabel, fxEvArg, fxEvParts, machineArg, posLabel, stacArg, stacParts, ALL_LOOPERS } from '../lib/protocol';
import { fadeLabel } from './FadeButton';

// What the Scaletta and the Improv share: the actions of each row, their values, and the
// box where you pick what happens in a cell.

export const SEC_ACTIONS = [EV.REC, EV.CUE_REC, EV.PLAY, EV.PAUSE, EV.CLEAR, EV.STACCO, EV.FADE_IN, EV.FADE_OUT, EV.FILTER, EV.EQ_LO, EV.EQ_MID, EV.EQ_HI];
export const LOOP_ACTIONS = [EV.PLAY_ALL, EV.STOP_ALL, EV.CLEAR, EV.STACCO, EV.FADE_IN, EV.FADE_OUT, EV.FILTER, EV.EQ_LO, EV.EQ_MID, EV.EQ_HI];
export const GEN_ACTIONS = [EV.WAIT, EV.CLEAR, EV.STACCO, EV.DRUMS, EV.PATTERN, EV.SYNTH, EV.TEMPO, EV.FILTER, EV.EQ_LO, EV.EQ_MID, EV.EQ_HI];
// a machine (plug-in only): its audio on / off, MIDI start / stop, pattern, stacco
export const MACH_ACTIONS = [EV.DRUMS, EV.MACHINE_RUN, EV.PATTERN, EV.STACCO];
export const LEADS = [
  { v: 0, label: 'Sulla stanghetta' },
  { v: 1, label: '1/8 prima' },
  { v: 2, label: '1/4 prima' },
  { v: 4, label: '1/2 bar prima' },
];

export const FILTER_PRESETS = [
  { v: 0, label: 'Passa-basso tutto' },
  { v: 50, label: 'Passa-basso metà' },
  { v: 100, label: 'Aperto' },
  { v: 150, label: 'Passa-alto metà' },
  { v: 200, label: 'Passa-alto tutto' },
];
export const EQ_PRESETS = [
  { v: 0, label: 'Kill' },
  { v: 50, label: 'Giù a metà' },
  { v: 100, label: 'Normale' },
  { v: 150, label: 'Su del 50%' },
];
export const DRUM_PRESETS = [
  { v: 0, label: 'Ferma la drum' },
  { v: 1, label: 'Fai partire la drum' },
];
export const MACH_PRESETS = [
  { v: 0, label: 'Spegni (audio, continua a girare)' },
  { v: 1, label: 'Accendi (audio)' },
];
export const RUN_PRESETS = [
  { v: 1, label: 'Start (MIDI)' },
  { v: 0, label: 'Stop (MIDI)' },
];

export const isFx = (t) => t === EV.FILTER || (t >= EV.EQ_LO && t <= EV.EQ_HI);

export function needsValue(t) {
  return t === EV.FADE_IN || t === EV.FADE_OUT || t === EV.FILTER || t === EV.TEMPO ||
    (t >= EV.EQ_LO && t <= EV.EQ_HI) || t === EV.DRUMS || t === EV.PATTERN || t === EV.STACCO || t === EV.SYNTH ||
    t === EV.MACHINE_RUN;
}

export function staccoLabel(v, barEighths) {
  const p = stacParts(v);
  const who = p.who === 'drum' ? ' · solo la drum' : p.who === 'all' ? ' · anche la drum' : '';
  return `${eighthsLabel(p.dur, barEighths)} ${posLabel(p.pos)}${who}`;
}

// Stacco: da dove parte (gli ottavi della bar) e quanto dura. La musica sotto continua a
// girare, quindi quando finisce tutto riparte esattamente a tempo.
export function StaccoPicker({ barEighths, gen, onAdd }) {
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(2);
  const [who, setWho] = useState('all');
  const durs = [1, 2, 3, 4, 5, 6, 7]
    .filter((d) => d < barEighths)
    .concat([barEighths, barEighths * 2, barEighths * 4].filter((d) => d <= 63));
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
        <>
          <div className="stc__label">Chi si ferma</div>
          <div className="show-pick__grid stc__who">
            {[
              ['all', 'Tutti (looper + drum)'],
              ['loopers', 'Solo i looper'],
              ['drum', 'Solo la drum'],
            ].map(([k, label]) => (
              <button key={k} type="button" className={`chip chip--sm ${who === k ? 'is-on' : ''}`} onClick={() => setWho(k)}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <button type="button" className="chip chip--ok stc__go" onClick={() => onAdd(stacArg(pos, dur, gen ? who : 'loopers'))}>
        Metti lo stacco
      </button>
    </div>
  );
}

export function valueLabel(e, barEighths = 8, synthList = []) {
  if (e.t === EV.FADE_IN || e.t === EV.FADE_OUT) return `${fadeLabel(e.v / 2)} bar`;
  if (e.t === EV.FILTER || (e.t >= EV.EQ_LO && e.t <= EV.EQ_HI)) {
    const { val, bars } = fxEvParts(e.v);
    const base = e.t === EV.FILTER
      ? (FILTER_PRESETS.find((p) => p.v === val) || {}).label || `${val}`
      : (EQ_PRESETS.find((p) => p.v === val) || {}).label || `${val}%`;
    return `${base} · ${bars > 0 ? `in ${fadeLabel(bars)} bar` : 'subito'}`;
  }
  if (e.t === EV.DRUMS) return e.l === MACHINE_ROW ? (e.v ? 'accesa' : 'spenta') : e.v ? 'in play' : 'in pausa';
  if (e.t === EV.MACHINE_RUN) return e.v ? 'start' : 'stop';
  if (e.t === EV.TEMPO) return `${Math.round(e.v / 100)} BPM`;
  if (e.t === EV.PATTERN) return `pattern ${e.v}`;
  if (e.t === EV.STACCO) return staccoLabel(e.v, barEighths);
  if (e.t === EV.SYNTH) return (synthList.find((x) => x.id === e.v) || {}).name || `suono ${e.v} (non c'è più)`;
  return '';
}

export function presetsFor(t, row) {
  return t === EV.FILTER ? FILTER_PRESETS
    : t >= EV.EQ_LO && t <= EV.EQ_HI ? EQ_PRESETS
    : t === EV.DRUMS ? (row && row.machine ? MACH_PRESETS : DRUM_PRESETS)
    : t === EV.MACHINE_RUN ? RUN_PRESETS
    : t === EV.FADE_IN || t === EV.FADE_OUT ? FADE_STEPS.map((b) => ({ v: b * 2, label: `${fadeLabel(b)} bar` }))
    : [];
}


// The box of a cell: what is already there (with Togli) and the actions to add.
//   row { label, l, s, machine } · barLabel "bar 5" · evs [{...event}] · actions [EV...]
//   onAdd(t, v) · onRemove(event) · onClose() · gen: the Generale row (stacco: who stops)
//   recLenLabel(e): how long a rec lasts (scaletta only)
export function EventPicker({
  row, barLabel, evs, actions, gen, onAdd, onRemove, onClose,
  barEighths = 8, synthList = [], machines = [], state, send, vst, recLenLabel,
}) {
  const [sub, setSub] = useState({});
  return (
  <div className="show-pick" onClick={onClose}>
    <div className="show-pick__box" onClick={(e) => e.stopPropagation()}>
      <div className="show-pick__head">
        <strong>{row.label}</strong>
        <span className="muted"> · {barLabel}</span>
      </div>

      {evs.length > 0 && (
        <div className="show-pick__list">
          {evs.map((e) => (
            <div className="show-pick__ev" key={e.i}>
              <span className={`showev showev--${EV_INFO[e.t]?.cls}`}>{EV_INFO[e.t]?.icon}</span>
              {EV_INFO[e.t]?.label}
              {needsValue(e.t) && <small> · {valueLabel(e, barEighths, synthList)}</small>}
              {recLenLabel && (e.t === EV.REC || e.t === EV.CUE_REC) && <small> · {recLenLabel(e)}</small>}
              <button type="button" className="chip chip--danger" onClick={() => onRemove(e)}>
                Togli
              </button>
            </div>
          ))}
        </div>
      )}

      {!sub.t ? (
        <>
          <div className="show-pick__grid">
            {actions.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip showev-btn showev-btn--${EV_INFO[t].cls}`}
                onClick={() => (needsValue(t) ? setSub({ t }) : onAdd(t))}
              >
                <span className={`showev showev--${EV_INFO[t].cls}`}>{EV_INFO[t].icon}</span>
                {EV_INFO[t].label}
              </button>
            ))}
          </div>
        </>
      ) : sub.t === EV.STACCO ? (
        <StaccoPicker
          barEighths={barEighths}
          gen={gen}
          onAdd={(v) => onAdd(EV.STACCO, v)}
        />
      ) : sub.t === EV.SYNTH ? (
        <div className="show-pick__grid">
          {synthList.length === 0 && (
            <span className="muted">
              Ancora nessun suono salvato: apri "Synth" sotto la griglia e salva i suoni che usi.
            </span>
          )}
          {synthList.map((x) => (
            <button key={x.id} type="button" className="chip" onClick={() => onAdd(EV.SYNTH, x.id)}>
              {x.name}
            </button>
          ))}
        </div>
      ) : sub.t === EV.PATTERN ? (
        <div className="show-pick__grid">
          <input
            className="show-name drumbox__num"
            type="number"
            min="1"
            max="100"
            defaultValue={(row.machine ? machines.find((m) => m.id === row.s)?.last : state?.drums?.uno?.last) || 1}
            id="show-pat"
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              onAdd(EV.PATTERN, Math.max(1, Math.min(100, Number(e.target.value) || 1)))
            }
          />
          <button
            type="button"
            className="chip"
            onClick={() =>
              onAdd(EV.PATTERN,
                Math.max(1, Math.min(100, Number(document.getElementById('show-pat').value) || 1))
              )
            }
          >
            Vai a questo pattern
          </button>
          <button
            type="button"
            className="chip chip--sm"
            onClick={() => {
              const n = Number(document.getElementById('show-pat').value) || 1;
              if (row.machine) send(ALL_LOOPERS, CMD.MACHINE_PATTERN, machineArg(row.s, n));
              else send(ALL_LOOPERS, CMD.UNO_PATTERN, n);
            }}
          >
            Provalo adesso
          </button>
        </div>
      ) : sub.t === EV.TEMPO ? (
        <div className="show-pick__grid">
          <input
            className="show-name"
            type="number"
            min="20"
            max="300"
            defaultValue={Math.round(state?.tempo || 120)}
            onKeyDown={(e) => e.key === 'Enter' && onAdd(EV.TEMPO, Number(e.target.value) * 100)}
            id="show-bpm"
          />
          <button
            type="button"
            className="chip"
            onClick={() =>
              onAdd(EV.TEMPO, Number(document.getElementById('show-bpm').value) * 100)
            }
          >
            Metti questo BPM
          </button>
          {vst && (
            <span className="muted">
              {state?.live?.on || state?.ctl?.ok
                ? 'Ableton cambia BPM sulla stanghetta.'
                : 'Per cambiare il BPM di Ableton collega il Remote Script ("Macchine e Ableton", sotto la griglia).'}
            </span>
          )}
        </div>
      ) : isFx(sub.t) && sub.val !== undefined ? (
        <>
          <div className="stc__label">
            Transizione <span className="muted">· {sub.valLabel}</span>
          </div>
          <div className="show-pick__grid">
            <button
              type="button"
              className="chip"
              onClick={() => onAdd(sub.t, fxEvArg(sub.val, 0))}
            >
              Subito
            </button>
            {FADE_STEPS.map((b) => (
              <button
                key={b}
                type="button"
                className="chip"
                onClick={() => onAdd(sub.t, fxEvArg(sub.val, b))}
              >
                in {fadeLabel(b)} bar
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="show-pick__grid">
          {presetsFor(sub.t, row).map((p) => (
            <button
              key={p.v}
              type="button"
              className="chip"
              onClick={() =>
                isFx(sub.t)
                  ? setSub({ ...sub, val: p.v, valLabel: p.label })
                  : onAdd(sub.t, p.v)
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
  );
}
