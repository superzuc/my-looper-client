import HoldButton from './HoldButton';
import { LicenceLine } from './LicenceScreen';
import { ALL_LOOPERS, CMD } from '../lib/protocol';

const NSLOTS = 8;

// Memories: save / load all loopers (audio + lengths + mixer) into 8 slots on disk.
export default function MemoryPanel({ state, send, onClose }) {
  const mem = state?.mem || [];
  const job = state?.job || null;
  const busy = !!(job && !job.done);
  const slots = Array.from({ length: NSLOTS }, (_, i) => mem.find((m) => m.slot === i + 1) || { slot: i + 1 });

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Memorie">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">Memorie</div>
            <div className="sheet__sub">
              Salvano tutti i looper nella cartella del progetto. Tieni premuto per sovrascrivere o caricare.
            </div>
          </div>
          <button type="button" className="chip" onClick={onClose}>
            Chiudi
          </button>
        </div>

        {job && (
          <div className={`job ${job.err ? 'job--err' : ''}`}>
            <div className="job__text">
              {job.err
                ? `Errore: ${job.err}`
                : job.done
                ? `${job.kind === 'save' ? 'Salvata' : 'Caricata'} memoria ${job.slot}: ${job.msg}`
                : `${job.kind === 'save' ? 'Salvataggio' : 'Caricamento'} memoria ${job.slot}… ${Math.round(
                    (job.p || 0) * 100
                  )}%`}
            </div>
            {!job.done && (
              <div className="job__bar">
                <span style={{ transform: `scaleX(${job.p || 0})` }} />
              </div>
            )}
          </div>
        )}

        <div className="slots">
          {slots.map((sl) => {
            const used = !!sl.saved;
            const other = sl.saved === 'altro account';   // encrypted with another GL-8 account
            return (
              <div key={sl.slot} className={`slot ${used ? 'is-used' : ''}`}>
                <div className="slot__num">{sl.slot}</div>
                <div className="slot__info">
                  {other ? (
                    <>
                      <strong>Altro account</strong>
                      <span>salvata con un altro account: si apre solo con quello</span>
                    </>
                  ) : used ? (
                    <>
                      <strong>{sl.saved}</strong>
                      <span>
                        {sl.n} {sl.n === 1 ? 'sezione' : 'sezioni'}
                        {sl.tempo ? ` · ${Math.round(Number(sl.tempo) * 10) / 10} BPM` : ''}
                      </span>
                    </>
                  ) : (
                    <span>vuota</span>
                  )}
                </div>
                <div className="slot__actions">
                  <HoldButton
                    ms={used ? 700 : 1}
                    className="chip chip--save"
                    disabled={busy}
                    onHold={() => send(ALL_LOOPERS, CMD.SAVE, sl.slot)}
                  >
                    Salva
                  </HoldButton>
                  <HoldButton
                    ms={700}
                    className="chip chip--load"
                    disabled={busy || !used || other}
                    onHold={() => send(ALL_LOOPERS, CMD.LOAD, sl.slot)}
                  >
                    Carica
                  </HoldButton>
                </div>
              </div>
            );
          })}
        </div>
        <LicenceLine state={state} send={send} />
      </div>
    </div>
  );
}
