import { useEffect, useRef, useState } from 'react';
import { CMD, panArg, volArg } from '../lib/protocol';

const SEND_EVERY_MS = 60;

// Sends the latest value at most every SEND_EVERY_MS while a slider is dragged.
function useThrottledSender(sendFn) {
  const timer = useRef(null);
  const latest = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (value) => {
    latest.current = value;
    if (timer.current) return;
    sendFn(value);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (latest.current !== value) sendFn(latest.current);
    }, SEND_EVERY_MS);
  };
}

const volLabel = (v) => (v <= 0.001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
const panLabel = (p) => (Math.abs(p) < 0.01 ? 'C' : p < 0 ? `L ${Math.round(-p * 100)}` : `R ${Math.round(p * 100)}`);

// Volume / pan / mute of the selected section.
export default function MixerStrip({ looperId, index, section, send }) {
  const [vol, setVol] = useState(null); // local value while dragging
  const [pan, setPan] = useState(null);
  const sendVol = useThrottledSender((v) => send(looperId, CMD.VOLUME, volArg(index, v)));
  const sendPan = useThrottledSender((p) => send(looperId, CMD.PAN, panArg(index, p)));

  // back to the value coming from REAPER once it caught up
  useEffect(() => {
    if (vol !== null && Math.abs((section.vol ?? 1) - vol) < 0.006) setVol(null);
  }, [section.vol, vol]);
  useEffect(() => {
    if (pan !== null && Math.abs((section.pan ?? 0) - pan) < 0.006) setPan(null);
  }, [section.pan, pan]);

  const v = vol ?? section.vol ?? 1;
  const p = pan ?? section.pan ?? 0;
  const muted = !!section.mute;

  return (
    <div className="mixer" aria-label={`Mixer sezione ${index + 1}`}>
      <div className="mixer__title">Sezione {index + 1}</div>

      <button
        type="button"
        className={`chip mixer__mute ${muted ? 'is-muted' : ''}`}
        onClick={() => send(looperId, CMD.MUTE, index)}
      >
        {muted ? 'Muto' : 'Mute'}
      </button>

      <button
        type="button"
        className={`chip mixer__cue ${section.cue ? 'is-cue' : ''}`}
        onClick={() => send(looperId, CMD.CUE, index)}
      >
        {section.cue ? 'In main' : 'In cuffia'}
      </button>

      <label className="mixer__ctl">
        <span className="mixer__lbl">
          Volume <b>{volLabel(v)}</b>
        </span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={v}
          onChange={(e) => {
            let x = Number(e.target.value);
            if (Math.abs(x - 1) < 0.03) x = 1; // snap to 0 dB
            setVol(x);
            sendVol(x);
          }}
        />
      </label>

      <label className="mixer__ctl">
        <span className="mixer__lbl">
          Pan <b>{panLabel(p)}</b>
        </span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={p}
          onChange={(e) => {
            let x = Number(e.target.value);
            if (Math.abs(x) < 0.06) x = 0; // snap to center
            setPan(x);
            sendPan(x);
          }}
        />
      </label>

      <button
        type="button"
        className="chip"
        onClick={() => {
          setVol(1);
          setPan(0);
          send(looperId, CMD.VOLUME, volArg(index, 1));
          send(looperId, CMD.PAN, panArg(index, 0));
        }}
      >
        Reset
      </button>
    </div>
  );
}
