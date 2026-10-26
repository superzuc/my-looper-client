import { memo, useEffect, useRef, useState } from 'react';
import { DOUBLE_TAP_MS, HOLD_MS, PEND, ST } from '../lib/protocol';
import { formatLength } from '../lib/format';

const R = 46;
const C = 2 * Math.PI * R;
const HC = 2 * Math.PI * (R - 5);

const STATE_INFO = {
  [ST.EMPTY]: { key: 'empty', label: 'Vuoto' },
  [ST.STOPPED]: { key: 'stopped', label: 'Pausa' },
  [ST.PLAYING]: { key: 'playing', label: 'Play' },
  [ST.RECORDING]: { key: 'rec', label: 'Rec' },
  [ST.OVERDUB]: { key: 'overdub', label: 'Overdub' },
};

const PEND_INFO = {
  [PEND.STOP]: { key: 'stopped', label: '→ Pausa' },
  [PEND.PLAY]: { key: 'playing', label: '→ Play' },
  [PEND.REC]: { key: 'rec', label: '→ Rec' },
};

const MOVE_CANCEL_PX = 14;

function lenLabel(beats, tsNum) {
  const l = formatLength(beats, tsNum);
  return `${l.value} ${l.unit}`;
}

// One big circle. Tap = play/pause (or end rec). Hold 0.8 s = record.
function SectionPad({ index, section, tsNum, selected, onTap, onHold, onCueHold, onImmediate, onEmptyTap }) {
  const [holding, setHolding] = useState(false);
  const [flash, setFlash] = useState(false);
  const holdTimer = useRef(null);
  const tapTimer = useRef(null);
  // gesture in progress: null | { phase: 'first' | 'second', x, y }
  const gesture = useRef(null);

  const st = STATE_INFO[section.st] || STATE_INFO[0];
  const pend = PEND_INFO[section.pend];
  const hasContent = section.has || section.st >= ST.RECORDING;
  const visualKey = section.st === ST.EMPTY && hasContent ? 'stopped' : st.key;
  const active = section.st >= ST.PLAYING;

  // latest values for the delayed single tap
  const latest = useRef({});
  latest.current = { hasContent, pend: section.pend, onTap, onEmptyTap };

  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  const cancelAll = () => {
    cancelHold();
    gesture.current = null;
  };

  // Gestures:
  //   tap            -> play / pause (sent DOUBLE_TAP_MS later, to tell it from a double tap)
  //   double tap     -> select / deselect
  //   hold HOLD_MS   -> rec
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // always get the pointerup
    } catch {}
    if (tapTimer.current) {
      // second press while the first tap is still waiting: double tap (immediate
      // play / pause), or silent rec if this second press is held down
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      gesture.current = { phase: 'second', x: e.clientX, y: e.clientY };
      setHolding(true);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        gesture.current = null;
        setHolding(false);
        setFlash(true);
        setTimeout(() => setFlash(false), 350);
        onCueHold(index);
      }, HOLD_MS);
      return;
    }
    gesture.current = { phase: 'first', x: e.clientX, y: e.clientY };
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      gesture.current = null;
      setHolding(false);
      setFlash(true);
      setTimeout(() => setFlash(false), 350);
      onHold(index);
    }, HOLD_MS);
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) cancelAll(); // it's a swipe
  };

  const onPointerUp = () => {
    const g = gesture.current;
    cancelAll();
    if (!g) return; // hold already fired, or swipe
    if (g.phase === 'second') {
      onImmediate(index);
      return;
    }
    const upAt = performance.now();
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      const l = latest.current;
      if (!l.hasContent && !l.pend) l.onEmptyTap && l.onEmptyTap();
      else l.onTap(index, performance.now() - upAt);
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => () => {
    clearTimeout(holdTimer.current);
    clearTimeout(tapTimer.current);
  }, []);

  return (
    <div className="pad-cell">
      <button
        type="button"
        className={[
          'pad',
          `pad--${visualKey}`,
          pend ? `pad--pending pad--pending-${pend.key}` : '',
          holding ? 'is-holding' : '',
          flash ? 'is-flash' : '',
          selected ? 'is-selected' : '',
          section.mute ? 'is-muted' : '',
          section.cue ? 'is-cue' : '',
        ].join(' ')}
        style={{ '--lvl': Math.min(1, section.lvl * 1.6).toFixed(3) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelAll}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`Sezione ${index + 1}: ${st.label}`}
      >
        <svg className="pad__svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="pad__disc" cx="50" cy="50" r={R} />
          <circle className="pad__track" cx="50" cy="50" r={R} />
          {active && (
            <circle
              className="pad__progress"
              cx="50"
              cy="50"
              r={R}
              style={{ strokeDasharray: C, '--c-len': `${C}px` }}
            />
          )}
          {pend && <circle className="pad__pending-ring" cx="50" cy="50" r={R - 5} />}
          <circle
            className="pad__hold"
            cx="50"
            cy="50"
            r={R - 5}
            style={{ strokeDasharray: HC, '--hc-len': `${HC}px`, '--hold-ms': `${HOLD_MS}ms` }}
          />
        </svg>
        {selected && <span className="pad__sel">Selezionata</span>}
        {section.mute ? <span className="pad__mute">Muto</span> : null}
        {section.cue ? <span className="pad__cue">Cue</span> : null}
        <span className="pad__content">
          <span className="pad__num">{index + 1}</span>
          <span className="pad__state">{pend ? pend.label : hasContent || section.st ? st.label : ''}</span>
          {section.beats > 0 && <span className="pad__len">{lenLabel(section.beats, tsNum)}</span>}
        </span>
      </button>
    </div>
  );
}

export default memo(SectionPad, (a, b) =>
  a.index === b.index &&
  a.section.st === b.section.st &&
  a.section.pend === b.section.pend &&
  a.section.has === b.section.has &&
  a.section.beats === b.section.beats &&
  a.section.mute === b.section.mute &&
  a.section.cue === b.section.cue &&
  a.onCueHold === b.onCueHold &&
  a.tsNum === b.tsNum &&
  a.selected === b.selected &&
  a.onImmediate === b.onImmediate &&
  Math.abs(a.section.lvl - b.section.lvl) < 0.04 &&
  a.onTap === b.onTap &&
  a.onHold === b.onHold
);
