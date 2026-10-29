import { ALL_LOOPERS, CMD } from '../lib/protocol';

// Mentre la scaletta gira, sotto l'header: a che bar sei, Indietro, Continua e Ferma,
// così non serve riaprire la finestra della scaletta.
export default function ShowStrip({ show, send, onOpen }) {
  if (!show || !show.st) return null;
  const waiting = show.st === 2;
  const back = show.back || 0;
  return (
    <div className={`show-strip ${waiting ? 'is-waiting' : ''}`}>
      <button type="button" className="show-strip__info" onClick={onOpen}>
        <span className="show-strip__dot" />
        <span className="show-strip__name">{show.name || 'Scaletta'}</span>
        <strong>bar {show.bar}</strong>
        {back > 0 ? (
          <span className="show-strip__back">↶ rifà dalla bar {show.bar + 1}</span>
        ) : waiting ? (
          <span className="muted">in attesa</span>
        ) : null}
      </button>
      {waiting ? (
        <button type="button" className="chip chip--sm show-strip__btn" onClick={() => send(ALL_LOOPERS, CMD.SHOW_CONTINUE)}>
          ⏭ Continua
        </button>
      ) : (
        <button
          type="button"
          className={`chip chip--sm show-strip__btn show-strip__btn--back ${back ? 'is-on' : ''}`}
          onClick={() => send(ALL_LOOPERS, CMD.SHOW_BACK)}
          title="Ripeti da capo la bar in cui sei (due volte = due bar)"
        >
          ↶ Indietro{back > 0 ? ` ${back}` : ''}
        </button>
      )}
      <button type="button" className="chip chip--sm show-strip__btn show-strip__btn--stop" onClick={() => send(ALL_LOOPERS, CMD.SHOW_STOP)}>
        ■ Ferma
      </button>
    </div>
  );
}
