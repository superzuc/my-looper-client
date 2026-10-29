import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import Header from './components/Header';
import LooperPage from './components/LooperPage';
import MemoryPanel from './components/MemoryPanel';
import FxPanel from './components/FxPanel';
import ShowPanel from './components/ShowPanel';
import ShowStrip from './components/ShowStrip';
import GridView from './components/GridView';
import { isDemo, useLooper } from './hooks/useLooper';
import { ALL_LOOPERS, PROTO } from './lib/protocol';

const PAGE_KEY = 'mylooper.page';
const FADE_KEY = 'mylooper.fadeBars';

function readSavedPage() {
  try {
    return Number(localStorage.getItem(PAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function readFadeBars() {
  try {
    const v = Number(localStorage.getItem(FADE_KEY));
    return v >= 0.25 && v <= 64 ? v : 1;
  } catch {
    return 1;
  }
}

function Notice({ conn, state }) {
  if (conn === 'offline')
    return (
      <div className="notice">
        <strong>REAPER non raggiungibile.</strong> Controlla che REAPER sia aperto, che il web server sia
        attivo (Preferenze → Control/OSC/web) e che l'iPad sia sulla stessa rete Wi-Fi.{' '}
        <a href="?demo">Prova la demo</a>
      </div>
    );
  if (conn === 'nobridge')
    return (
      <div className="notice">
        <strong>Bridge non attivo.</strong> In REAPER esegui lo script <code>MyLooper_bridge.lua</code>{' '}
        (Actions → Load ReaScript).
      </div>
    );
  if (state && !state.demo && state.proto > PROTO)
    return (
      <div className="notice">
        <strong>La pagina è più vecchia del bridge.</strong> Ricaricala (su iPad: chiudi la scheda e riaprila).
      </div>
    );
  if (state && !state.demo && state.proto !== PROTO)
    return (
      <div className="notice">
        <strong>In REAPER gira una versione vecchia del bridge.</strong> Chiudi e riapri REAPER (oppure riesegui{' '}
        <code>MyLooper_bridge.lua</code>) dopo aver fatto <code>npm run deploy</code>.
      </div>
    );
  if (state && !state.demo && state.loopers.some((l) => l.alive && l.ver !== PROTO))
    return (
      <div className="notice">
        <strong>Il JSFX caricato in REAPER è una versione vecchia.</strong> Chiudi e riapri il progetto (o REAPER)
        per ricaricare <code>MyLooper.jsfx</code>. Finché le versioni non coincidono i cerchi possono mostrare stati
        sbagliati.
      </div>
    );
  if (state && state.loopers.length === 0)
    return (
      <div className="notice">
        <strong>Nessun looper trovato.</strong> Aggiungi il JSFX <code>MyLooper</code> alle tracce degli strumenti.
      </div>
    );
  return null;
}

export default function App() {
  const { state, conn, send, receivedAt, client } = useLooper();
  const pagerRef = useRef(null);
  const [page, setPage] = useState(readSavedPage);
  const [toast, setToast] = useState(null);
  const [showMem, setShowMem] = useState(false);
  const [fxTarget, setFxTarget] = useState(null);      // null = panel closed
  const [showOpen, setShowOpen] = useState(false);
  const [sel, setSel] = useState(null);                // { id, s } selected section
  const [grid, setGrid] = useState(false);
  const [fadeBars, setFadeBars] = useState(readFadeBars);
  const dotsRef = useRef(null);
  const toastTimer = useRef(null);
  const restored = useRef(false);
  const loopers = state?.loopers || [];

  // restore the last page once loopers are known
  useEffect(() => {
    if (restored.current || !loopers.length || !pagerRef.current) return;
    restored.current = true;
    const p = Math.min(page, loopers.length - 1);
    pagerRef.current.scrollLeft = p * pagerRef.current.clientWidth;
  }, [loopers.length, page]);

  const onScroll = () => {
    const el = pagerRef.current;
    if (!el || !el.clientWidth) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p !== page) {
      setPage(p);
      try {
        localStorage.setItem(PAGE_KEY, String(p));
      } catch {}
    }
  };

  // smooth between neighbours, but an instant jump when it is far away:
  // with many instruments a smooth scroll across the whole pager is slow
  const goTo = useCallback(
    (p) => {
      const el = pagerRef.current;
      if (!el) return;
      el.scrollTo({ left: p * el.clientWidth, behavior: Math.abs(p - page) > 1 ? 'auto' : 'smooth' });
    },
    [page]
  );

  // keyboard arrows (handy when testing on a computer)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') goTo(Math.min(page + 1, loopers.length - 1));
      if (e.key === 'ArrowLeft') goTo(Math.max(page - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, page, loopers.length]);

  const changeFadeBars = useCallback((b) => {
    setFadeBars(b);
    try {
      localStorage.setItem(FADE_KEY, String(b));
    } catch {}
  }, []);

  // keep the instrument bar scrolled on the current one (with many instruments it scrolls)
  useEffect(() => {
    const el = dotsRef.current;
    if (!el) return;
    const active = el.children[page];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [page, loopers.length, grid]);

  const onEmptyTap = useCallback(() => {
    setToast('Tieni premuto 0,8 s per registrare');
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      <Header
        state={state}
        conn={conn}
        send={send}
        demo={isDemo()}
        onMemories={() => setShowMem(true)}
        grid={grid}
        onToggleGrid={() => setGrid((g) => !g)}
        fadeBars={fadeBars}
        onFadeBars={changeFadeBars}
        onFx={() => setFxTarget(sel ? { id: sel.id, s: sel.s } : { id: ALL_LOOPERS, s: null })}
        fxOn={!!fxTarget}
        onShow={() => setShowOpen(true)}
        showOn={!!(state?.show && state.show.st > 0)}
      />
      <Notice conn={conn} state={state} />
      <ShowStrip show={state?.show} send={send} onOpen={() => setShowOpen(true)} />

      {grid ? (
        <GridView
          loopers={loopers}
          send={send}
          receivedAt={receivedAt}
          onEmptyTap={onEmptyTap}
          fadeBars={fadeBars}
        />
      ) : (
      <main className="pager" ref={pagerRef} onScroll={onScroll}>
        {loopers.map((l, i) => (
          <LooperPage
            key={l.id}
            tempo={state?.tempo}
            looper={l}
            index={i}
            total={loopers.length}
            send={send}
            receivedAt={receivedAt}
            onEmptyTap={onEmptyTap}
            fadeBars={fadeBars}
            selected={sel && sel.id === l.id ? sel.s : null}
            onSelect={(x) => setSel(x === null ? null : { id: l.id, s: x })}
            onFx={(x) => setFxTarget({ id: l.id, s: x })}
          />
        ))}
      </main>
      )}

      {!grid && loopers.length > 1 && (
        <nav className="dots" aria-label="Looper" ref={dotsRef}>
          {loopers.map((l, i) => (
            <button
              key={l.id}
              type="button"
              className={`dots__dot ${i === page ? 'is-on' : ''}`}
              style={{ '--track': l.color || 'var(--accent)' }}
              onClick={() => goTo(i)}
              aria-label={l.name}
            >
              <span>{l.name}</span>
            </button>
          ))}
        </nav>
      )}

      {toast && <div className="toast">{toast}</div>}
      {showMem && <MemoryPanel state={state} send={send} onClose={() => setShowMem(false)} />}
      {showOpen && (
        <ShowPanel
          state={state}
          send={send}
          client={client.current}
          onClose={() => setShowOpen(false)}
        />
      )}
      {fxTarget && (
        <FxPanel
          state={state}
          send={send}
          target={fxTarget}
          onTarget={(t) => {
            setFxTarget(t);
            setSel(t.s == null ? null : { id: t.id, s: t.s });
          }}
          onClose={() => setFxTarget(null)}
        />
      )}
    </div>
  );
}
