import { useEffect, useRef, useState } from 'react';
import BarsPrompt from './BarsPrompt';
import { CMD, FADE_IN, FADE_MAX, FADE_MIN, FADE_OUT, FADE_STEPS, fadeArg, fadeSecArg } from '../lib/protocol';

// Fade out: works only in Bar mode, because it has to land on the grid.
// One press = start (the length comes from the ½ / ×2 setting next to it),
// a second press while it runs = cancel. At the end everything goes to pause.
const CLS = {
  big: 'big-btn big-btn--fade',
  chip: 'chip chip--fade',
  mini: 'mini mini--fade',
};

export const fadeLabel = (bars) => (bars < 1 ? '½' : String(bars));

export default function FadeButton({
  target,
  send,
  bars,
  enabled,
  fading,
  size = 'big',
  what,
  dir = FADE_OUT,
  section = null,
}) {
  const inward = dir === FADE_IN;
  const verb = inward ? 'Fade in' : 'Fade out';
  return (
    <button
      type="button"
      className={`${CLS[size]} ${inward ? 'is-in' : 'is-out'} ${fading ? 'is-fading' : ''}`}
      disabled={!enabled}
      onClick={() =>
        section == null
          ? send(target, CMD.FADE, fadeArg(bars, dir))
          : send(target, CMD.FADE_SEC, fadeSecArg(section, bars, dir))
      }
      aria-label={`${verb} ${what || ''}`.trim()}
      title={
        enabled
          ? `${verb} in ${fadeLabel(bars)} bar${what ? ' — ' + what : ''}` +
            (inward ? ' (parte da zero)' : ', poi tutto in pausa') +
            ' — premi di nuovo per annullare'
          : 'I fade funzionano solo in modalità Bar'
      }
    >
      <span className="fade-ico">{inward ? '▲' : '▼'}</span>
      {size === 'big' && (
        <span>
          Fade<span className="big-btn__long">{inward ? ' in' : ' out'}</span>
        </span>
      )}
      {size === 'chip' && <span>{inward ? 'In' : 'Out'}</span>}
    </button>
  );
}

// Length of the fade, halved and doubled like the rec length (½ bar … 32 bar).
// It is set *before* pressing Fade. On a phone the ½ / ×2 buttons are hidden and
// the value opens the whole list, so it stays one thumb-sized button.
export function FadeLen({ bars, onChange }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="fade-len" ref={ref}>
      <button
        type="button"
        className="fade-len__step"
        disabled={bars <= FADE_MIN}
        onClick={() => onChange(Math.max(FADE_MIN, bars / 2))}
        aria-label="Dimezza la lunghezza del fade"
      >
        ½
      </button>

      <button
        type="button"
        className="fade-len__val"
        onClick={() => setOpen((o) => !o)}
        title="Lunghezza del fade out"
        aria-label={`Fade di ${fadeLabel(bars)} bar`}
      >
        <strong>{fadeLabel(bars)}</strong>
        <small>bar</small>
      </button>

      <button
        type="button"
        className="fade-len__step"
        disabled={bars >= FADE_MAX}
        onClick={() => onChange(Math.min(FADE_MAX, bars * 2))}
        aria-label="Raddoppia la lunghezza del fade"
      >
        ×2
      </button>

      {open && (
        <div className="fade-len__menu" role="listbox" aria-label="Lunghezza del fade out">
          <button
            type="button"
            className="fade-len__opt fade-len__opt--more"
            onClick={() => {
              setOpen(false);
              setTyping(true);
            }}
          >
            ⌨
            <small>scrivi</small>
          </button>
          {FADE_STEPS.map((b) => (
            <button
              key={b}
              type="button"
              role="option"
              aria-selected={b === bars}
              className={`fade-len__opt ${b === bars ? 'is-on' : ''}`}
              onClick={() => {
                onChange(b);
                setOpen(false);
              }}
            >
              {fadeLabel(b)}
              <small>bar</small>
            </button>
          ))}
        </div>
      )}

      {typing && (
        <BarsPrompt
          value={bars}
          min={0.25}
          max={64}
          quick={[3, 6, 12, 24, 48, 64]}
          title="Lunghezza del fade"
          onClose={() => setTyping(false)}
          onOk={(b) => {
            onChange(b);
            setTyping(false);
          }}
        />
      )}
    </div>
  );
}
