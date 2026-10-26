import { useRef } from 'react';
import { ALL_LOOPERS, CMD, FADE_IN, FADE_OUT } from '../lib/protocol';
import FadeButton, { FadeLen } from './FadeButton';

const CONN_LABEL = {
  ok: 'Connesso',
  connecting: 'Connessione…',
  offline: 'REAPER non raggiungibile',
  nobridge: 'Bridge Lua non attivo',
};

export default function Header({
  state,
  conn,
  send,
  demo,
  onMemories,
  grid,
  onToggleGrid,
  fadeBars,
  onFadeBars,
  onFx,
  fxOn,
  onShow,
  showOn,
}) {
  const playing = state?.playing;
  const drums = state?.drums;
  const drumsOff = !!(drums && drums.mute);
  const drumsPend = !!(drums && drums.pend >= 0);
  const drumsSync = drums && drums.sync && drums.sync.bar > 0;
  // tap = pausa / play; tenuto premuto = rimettila a tempo alla prossima bar
  const holdRef = useRef({ t: null, fired: false });
  const drumDown = () => {
    holdRef.current.fired = false;
    clearTimeout(holdRef.current.t);
    holdRef.current.t = setTimeout(() => {
      holdRef.current.fired = true;
      send(ALL_LOOPERS, CMD.DRUM_SYNC);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 700);
  };
  const drumUp = () => clearTimeout(holdRef.current.t);
  const loopers = state?.loopers || [];
  // the fade has to land on a bar, so it needs at least one looper in Bar mode
  const canFade = loopers.some((l) => l.mode);
  const fading = loopers.some((l) => l.fade > 0);
  return (
    <header className="header">
      <div className="header__brand">
        <span className={`dot dot--${conn}`} />
        <div>
          <div className="brand">MyLooper{demo && <span className="badge">demo</span>}</div>
          <div className="header__conn">{CONN_LABEL[conn] || conn}</div>
        </div>
      </div>

      <button
        type="button"
        className={`transport ${playing ? 'is-playing' : ''}`}
        onClick={() => send(ALL_LOOPERS, CMD.TRANSPORT)}
        aria-label={playing ? 'Ferma REAPER' : 'Avvia REAPER'}
      >
        <span className="transport__icon">{playing ? '■' : '▶'}</span>
        <span className="transport__text">
          <strong>{state ? Math.round(state.tempo * 10) / 10 : '--'}</strong> BPM
        </span>
      </button>

      <button type="button" className={`chip chip--grid ${grid ? 'is-on' : ''}`} onClick={onToggleGrid}>
        {grid ? 'Strumenti' : 'Griglia'}
      </button>

      <button type="button" className={`chip chip--fx ${fxOn ? 'is-on' : ''}`} onClick={onFx}>
        FX
      </button>

      <button type="button" className={`chip chip--show ${showOn ? 'is-on' : ''}`} onClick={onShow}>
        <span className="chip__long">Scaletta</span>
        <span className="chip__short">Scal</span>
      </button>

      <button type="button" className="chip chip--mem" onClick={onMemories}>
        <span className="chip__long">Memorie</span>
        <span className="chip__short">Mem</span>
      </button>

      <div className="header__global">
        <button type="button" className="big-btn big-btn--play" onClick={() => send(ALL_LOOPERS, CMD.PLAY_ALL)}>
          <span className="big-btn__icon">▶</span>
          <span>
            Play<span className="big-btn__long"> tutti</span>
          </span>
        </button>
        <button type="button" className="big-btn big-btn--stop" onClick={() => send(ALL_LOOPERS, CMD.STOP_ALL)}>
          <span className="big-btn__icon">❚❚</span>
          <span>
            Stop<span className="big-btn__long"> tutti</span>
          </span>
        </button>

        {drums && (
          <button
            type="button"
            className={`big-btn big-btn--drum ${drumsOff ? 'is-off' : ''} ${drumsPend ? 'is-pending' : ''} ${
              drumsSync ? 'is-syncing' : ''
            }`}
            disabled={!drums.n}
            onPointerDown={drumDown}
            onPointerUp={drumUp}
            onPointerLeave={drumUp}
            onPointerCancel={drumUp}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (holdRef.current.fired) return;   // era una pressione lunga
              send(ALL_LOOPERS, CMD.DRUMS);
            }}
            title={
              drums.n
                ? 'Tocca: drum in pausa / in play (a fine bar) · Tieni premuto: rimettila a tempo'
                : 'Nessuna traccia drum trovata'
            }
          >
            <span className="big-btn__icon">{drumsSync ? '⟳' : drumsOff ? '▶' : '❚❚'}</span>
            <span>Drum</span>
          </button>
        )}

        <div className="fade-group">
          <FadeButton
            target={ALL_LOOPERS}
            send={send}
            bars={fadeBars}
            enabled={canFade}
            fading={fading}
            dir={FADE_IN}
          />
          <FadeButton
            target={ALL_LOOPERS}
            send={send}
            bars={fadeBars}
            enabled={canFade}
            fading={fading}
            dir={FADE_OUT}
          />
          <FadeLen bars={fadeBars} onChange={onFadeBars} />
        </div>
      </div>
    </header>
  );
}
