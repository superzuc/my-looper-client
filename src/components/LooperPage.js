import { useCallback, useEffect, useRef, useState } from 'react';
import SectionPad from './SectionPad';
import HoldButton from './HoldButton';
import MixerStrip from './MixerStrip';
import FadeButton from './FadeButton';
import BarsPrompt from './BarsPrompt';
import { CMD, FADE_IN, FADE_OUT, tapArg } from '../lib/protocol';
import { livePos } from '../hooks/useLooper';
import { formatLength } from '../lib/format';

export default function LooperPage({
  tempo,
  looper,
  index,
  total,
  send,
  receivedAt,
  onEmptyTap,
  fadeBars,
  selected,
  onSelect,
  onFx,
}) {
  const rootRef = useRef(null);
  const looperRef = useRef(looper);
  looperRef.current = looper;
  const id = looper.id;

  // animate loop position (CSS var --pos) between two polls
  useEffect(() => {
    let raf;
    const step = () => {
      const p = livePos(looperRef.current, receivedAt.current, performance.now());
      const root = rootRef.current;
      if (root) {
        root.style.setProperty('--pos', p.toFixed(4));
        const l = looperRef.current;
        root.style.setProperty('--fadeg', (l.fade > 0 ? l.fadeG : 1).toFixed(3));
        // every section has its own loop length -> its own position
        const now = performance.now();
        root.querySelectorAll('.pad').forEach((el, i) => {
          const sec = looperRef.current.sections[i];
          if (!sec || !sec.lenSec) return;
          const sp = livePos({ ...sec, running: looperRef.current.running }, receivedAt.current, now);
          el.style.setProperty('--spos', sp.toFixed(4));
          el.style.setProperty('--sfade', (sec.fade ? sec.fadeG : 1).toFixed(3));
        });
      }
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [receivedAt]);

  // the selected section (chip "Sezione" in the toolbar): ½ / ×2 / kill / mixer /
  // fade / FX act on it instead of on the whole looper
  const sel = selected !== null && selected !== undefined ? looper.sections[selected] : null;
  const selHas = !!(sel && (sel.has || sel.st >= 3));

  // a section that got emptied can't stay selected
  useEffect(() => {
    if (selected !== null && selected !== undefined && !selHas) onSelect(null);
  }, [selected, selHas, onSelect]);

  const onTap = useCallback((s, lateMs = 0) => send(id, CMD.TAP, tapArg(s, lateMs)), [send, id]);
  const onHold = useCallback((s) => send(id, CMD.HOLD, s), [send, id]);
  const onCueHold = useCallback((s) => send(id, CMD.CUE_REC, s), [send, id]);
  // double tap: play / pause right now, ignoring the bar
  const onImmediate = useCallback((s) => send(id, CMD.TAP_NOW, s), [send, id]);

  // the chip walks through the sections that have something in them, then back to none
  const cycleSel = useCallback(() => {
    const list = looperRef.current.sections
      .map((x, i) => (x.has || x.st >= 3 ? i : -1))
      .filter((i) => i >= 0);
    if (!list.length) return onSelect(null);
    const cur = list.indexOf(selected);
    onSelect(cur < 0 ? list[0] : cur + 1 >= list.length ? null : list[cur + 1]);
  }, [onSelect, selected]);

  const target = selHas
    ? {
        beats: sel.beats,
        caption: `sezione ${selected + 1}`,
        canHalve: sel.beats > 0.5 && sel.st !== 3,
        canDouble: sel.st !== 3 && sel.lenSec * 2 <= (looper.maxSec || Infinity),
        halve: () => send(id, CMD.HALVE_SECTION, selected),
        double: () => send(id, CMD.DOUBLE_SECTION, selected),
      }
    : {
        beats: looper.beats,
        caption: 'prossima rec',
        canHalve: looper.beats > 0.5,
        canDouble: !!looper.canDouble,
        halve: () => send(id, CMD.HALVE),
        double: () => send(id, CMD.DOUBLE),
      };
  // quante bar ci stanno davvero in memoria (il ×2 si ferma molto prima)
  const beatSec = (60 / (tempo || 120)) * (4 / (looper.tsDenom || 4));
  const barSec = (looper.tsNum || 4) * beatSec;
  const maxBars = Math.max(1, Math.floor((looper.maxSec || 40) / barSec + 1e-6));
  const [typeBars, setTypeBars] = useState(false);

  const len = formatLength(target.beats, looper.tsNum);
  const tickCount = Math.min(64, Math.max(1, Math.round(looper.beats)));
  const barEvery = looper.tsNum || 4;

  return (
    <section
      className="page"
      ref={rootRef}
      style={{ '--track': looper.color || 'var(--accent)' }}
      aria-label={`Looper ${looper.name}`}
    >
      <div className="page__top">
        <div className="page__title">
          <span className="page__swatch" />
          <div>
            <div className="page__name">{looper.name}</div>
            <div className="page__sub">
              Looper {index + 1} di {total}
              {!looper.alive && <span className="warn"> · il JSFX non risponde</span>}
              {looper.alive && !looper.running && <span className="muted"> · transport fermo</span>}
            </div>
          </div>
        </div>

        <div className="toolbar">
          <div className="seg" role="group" aria-label="Modalità">
            <button
              type="button"
              className={`seg__btn ${!looper.mode ? 'is-on' : ''}`}
              onClick={() => send(id, CMD.MODE, 0)}
            >
              Normale<small>subito</small>
            </button>
            <button
              type="button"
              className={`seg__btn ${looper.mode ? 'is-on' : ''}`}
              onClick={() => send(id, CMD.MODE, 1)}
            >
              Bar<small>fine giro</small>
            </button>
          </div>

          <div className={`stepper ${selHas ? 'is-section' : ''}`} aria-label={`Lunghezza ${target.caption}`}>
            <button type="button" className="stepper__btn" onClick={target.halve} disabled={!target.canHalve}>
              ½
            </button>
            <button
              type="button"
              className="stepper__value stepper__value--btn"
              onClick={() => setTypeBars(true)}
              title="Tocca per scrivere il numero di bar"
            >
              <small>{target.caption}</small>
              <strong>{len.value}</strong>
              <span>{len.unit}</span>
            </button>
            <button type="button" className="stepper__btn" onClick={target.double} disabled={!target.canDouble}>
              ×2
            </button>
          </div>

          <button
            type="button"
            className={`chip chip--undo ${looper.undo === 2 ? 'is-redo' : ''}`}
            disabled={!looper.undo}
            onClick={() => send(id, CMD.UNDO)}
            aria-label={looper.undo === 2 ? 'Redo' : 'Undo'}
          >
            {looper.undo === 2 ? '↷ Redo' : '↶ Undo'}
            {looper.undo > 0 && looper.undoSec >= 0 && <small> {looper.undoSec + 1}</small>}
          </button>

          <button
            type="button"
            className={`chip ${looper.mon ? 'is-on' : ''}`}
            onClick={() => send(id, CMD.MONITOR)}
          >
            Monitor
          </button>

          <button
            type="button"
            className={`chip chip--sel ${selHas ? 'is-on' : ''}`}
            onClick={cycleSel}
            title="Sceglie la sezione su cui agiscono ½ / ×2, Kill, mixer, fade ed effetti"
          >
            Sezione <strong>{selHas ? selected + 1 : '—'}</strong>
          </button>

          <div className="fade-pair">
            <FadeButton
              target={id}
              send={send}
              bars={fadeBars}
              enabled={!!looper.mode}
              fading={selHas ? sel.fade > 0 : looper.fade > 0}
              size="chip"
              dir={FADE_IN}
              section={selHas ? selected : null}
              what={selHas ? `sezione ${selected + 1}` : looper.name}
            />
            <FadeButton
              target={id}
              send={send}
              bars={fadeBars}
              enabled={!!looper.mode}
              fading={selHas ? sel.fade > 0 : looper.fade > 0}
              size="chip"
              dir={FADE_OUT}
              section={selHas ? selected : null}
              what={selHas ? `sezione ${selected + 1}` : looper.name}
            />
          </div>

          <button type="button" className="chip chip--fx" onClick={() => onFx(selHas ? selected : null)}>
            FX
          </button>

          {selHas ? (
            <HoldButton
              key="kill"
              ms={600}
              className="chip chip--danger chip--kill"
              onHold={() => {
                send(id, CMD.CLEAR_SECTION, selected);
                onSelect(null);
              }}
            >
              Kill {selected + 1}
            </HoldButton>
          ) : (
            <HoldButton key="clear" ms={1000} className="chip chip--danger" onHold={() => send(id, CMD.CLEAR_ALL)}>
              Svuota
            </HoldButton>
          )}
        </div>
      </div>

      {selHas && <MixerStrip looperId={id} index={selected} section={sel} send={send} />}

      <div className="posbar" aria-hidden="true">
        <div className="posbar__fill" />
        <div className="posbar__ticks">
          {Array.from({ length: tickCount }, (_, i) => (
            <span key={i} className={i % barEvery === 0 ? 'is-bar' : ''} />
          ))}
        </div>
      </div>

      {typeBars && (
        <BarsPrompt
          value={Math.round((target.beats / (looper.tsNum || 4)) * 100) / 100}
          min={0.25}
          max={maxBars}
          quick={[1, 2, 3, 4, 6, 8, 12, 16, 24, 32]}
          title={selHas ? `Lunghezza della sezione ${selected + 1}` : 'Lunghezza della prossima rec'}
          onClose={() => setTypeBars(false)}
          onOk={(bars) => {
            const beats = Math.max(0.5, bars * (looper.tsNum || 4));
            if (selHas) send(id, CMD.SET_SEC_BEATS, selected + 8 * Math.round(beats * 2));
            else send(id, CMD.SET_BEATS, Math.round(beats * 2));
            setTypeBars(false);
          }}
        />
      )}

      <div className="pads">
        {looper.sections.map((s, i) => (
          <SectionPad
            key={i}
            index={i}
            section={s}
            tsNum={looper.tsNum}
            selected={selected === i}
            onTap={onTap}
            onHold={onHold}
            onCueHold={onCueHold}
            onImmediate={onImmediate}
            onEmptyTap={onEmptyTap}
          />
        ))}
      </div>
    </section>
  );
}
