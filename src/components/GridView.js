import { useCallback, useEffect, useRef } from 'react';
import SectionPad from './SectionPad';
import { ALL_LOOPERS, CMD, FADE_IN, FADE_OUT, tapArg } from '../lib/protocol';
import FadeButton from './FadeButton';
import { livePos } from '../hooks/useLooper';

// One row per looper, its 8 sections on the row: play / pause / rec on any
// instrument without changing page. Same gestures as the single looper page.
function GridRow({ looper, send, onEmptyTap, fadeBars }) {
  const id = looper.id;
  const onTap = useCallback((s, lateMs = 0) => send(id, CMD.TAP, tapArg(s, lateMs)), [send, id]);
  const onHold = useCallback((s) => send(id, CMD.HOLD, s), [send, id]);
  const onCueHold = useCallback((s) => send(id, CMD.CUE_REC, s), [send, id]);
  const onImmediate = useCallback((s) => send(id, CMD.TAP_NOW, s), [send, id]);

  return (
    <div
      className="grow"
      style={{
        '--track': looper.color || 'var(--accent)',
        '--fadeg': looper.fade > 0 ? looper.fadeG : 1,
      }}
    >
      <div className="grow__head">
        <div className="grow__name" title={looper.name}>
          {looper.name}
        </div>
        <div className="grow__btns">
          <button type="button" className="mini mini--play" onClick={() => send(id, CMD.PLAY_ALL)}>
            ▶
          </button>
          <button type="button" className="mini mini--stop" onClick={() => send(id, CMD.STOP_ALL)}>
            ❚❚
          </button>
          <FadeButton
            target={id}
            send={send}
            bars={fadeBars}
            enabled={!!looper.mode}
            fading={looper.fade > 0}
            size="mini"
            dir={FADE_IN}
            what={looper.name}
          />
          <FadeButton
            target={id}
            send={send}
            bars={fadeBars}
            enabled={!!looper.mode}
            fading={looper.fade > 0}
            size="mini"
            dir={FADE_OUT}
            what={looper.name}
          />
        </div>
      </div>

      {looper.sections.map((s, i) => (
        <SectionPad
          key={i}
          index={i}
          section={s}
          tsNum={looper.tsNum}
          selected={false}
          onTap={onTap}
          onHold={onHold}
          onCueHold={onCueHold}
          onImmediate={onImmediate}
          onEmptyTap={onEmptyTap}
        />
      ))}
    </div>
  );
}

export default function GridView({ loopers, send, receivedAt, onEmptyTap, fadeBars }) {
  const rootRef = useRef(null);
  const loopersRef = useRef(loopers);
  loopersRef.current = loopers;

  // loop position on every pad of every looper
  useEffect(() => {
    let raf;
    const step = () => {
      const root = rootRef.current;
      if (root) {
        const now = performance.now();
        root.querySelectorAll('.grow').forEach((row, r) => {
          const l = loopersRef.current[r];
          if (!l) return;
          row.querySelectorAll('.pad').forEach((el, i) => {
            const sec = l.sections[i];
            if (!sec) return;
            el.style.setProperty('--sfade', (sec.fade ? sec.fadeG : 1).toFixed(3));
            if (!sec.lenSec) return;
            el.style.setProperty(
              '--spos',
              livePos({ ...sec, running: l.running }, receivedAt.current, now).toFixed(4)
            );
          });
        });
      }
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [receivedAt]);

  return (
    <main className="grid" ref={rootRef}>
      <div className="grid__bar">
        <span className="grid__hint">Tocco: play / pausa · Tieni premuto: rec · Tocco + tieni premuto: rec silenziosa</span>
        <div className="grid__all">
          <button type="button" className="mini mini--play" onClick={() => send(ALL_LOOPERS, CMD.PLAY_ALL)}>
            ▶ tutti
          </button>
          <button type="button" className="mini mini--stop" onClick={() => send(ALL_LOOPERS, CMD.STOP_ALL)}>
            ❚❚ tutti
          </button>
        </div>
      </div>

      {loopers.map((l) => (
        <GridRow key={l.id} looper={l} send={send} onEmptyTap={onEmptyTap} fadeBars={fadeBars} />
      ))}
    </main>
  );
}
