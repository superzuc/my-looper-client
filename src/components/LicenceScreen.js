import { CMD } from '../lib/protocol';
import HoldButton from './HoldButton';

// GL-8 plug-in only: activation, trial and purchase (core/licence.h in the plug-in).
// state.lic = { req, st, plan, email, days, code, url, err, site }
//   st: none checking ok offline over revoked pending error

const ERR = {
  net: 'Il sito non risponde: controlla la connessione del computer.',
  expired: 'Il codice è scaduto: chiedine un altro.',
  'trial-taken': 'Su questo computer la prova è già stata usata con un altro account.',
  'too-many-devices': 'Il tuo account è già attivo su 3 computer: togline uno dalla pagina Account del sito.',
  'rate-limited': 'Troppi tentativi: riprova tra qualche minuto.',
  revoked: 'Questo computer è stato tolto dal tuo account.',
  invalid: 'La licenza su questo computer non è valida.',
};

export function licenceLocked(state) {
  return !!(state && !state.demo && state.host === 'vst3' && state.lic && state.lic.req === 1 && state.lic.st !== 'ok');
}

function siteOf(lic) {
  return (lic.site || 'https://girolooper8.com').replace(/\/$/, '');
}

export default function LicenceScreen({ state, send }) {
  const lic = state.lic;
  const site = siteOf(lic);
  const err = lic.err && (ERR[lic.err] || `Errore: ${lic.err}`);
  const btn = (code, label, primary) => (
    <button type="button" className={`lic__btn ${primary ? 'is-primary' : ''}`} onClick={() => send(0, code, 0)}>
      {label}
    </button>
  );

  let title, text, actions;
  switch (lic.st) {
    case 'checking':
      title = 'Controllo la licenza…';
      text = 'Un attimo: GL-8 sta parlando con girolooper8.com.';
      break;
    case 'pending':
      title = 'Conferma sul sito';
      text = (
        <>
          Apri questo indirizzo (anche dal telefono), entra con la tua email e conferma il codice:
          <a className="lic__url" href={lic.url} target="_blank" rel="noreferrer">
            {lic.url.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}
          </a>
          <span className="lic__code">{lic.code}</span>
          <span className="lic__wait">In attesa della conferma…</span>
        </>
      );
      actions = btn(CMD.LIC_CANCEL, 'Annulla');
      break;
    case 'offline':
      title = 'Serve internet';
      text = 'Durante la prova GL-8 controlla la licenza a ogni avvio. Collega il computer a internet e riprova.';
      actions = (
        <>
          {btn(CMD.LIC_RETRY, 'Riprova', true)}
          {btn(CMD.LIC_SIGN_OUT, 'Esci')}
        </>
      );
      break;
    case 'over':
      title = 'La prova è finita';
      text = (
        <>
          La prova di <strong>{lic.email}</strong> è finita. Acquista GL-8 dalla pagina{' '}
          <a href={`${site}/account`} target="_blank" rel="noreferrer">
            Account
          </a>{' '}
          del sito, poi premi Riprova: le tue memorie e scalette restano lì.
        </>
      );
      actions = (
        <>
          {btn(CMD.LIC_RETRY, 'Riprova', true)}
          {btn(CMD.LIC_SIGN_OUT, 'Esci')}
        </>
      );
      break;
    case 'revoked':
      title = 'Computer tolto dall’account';
      text = 'Questo computer è stato tolto dal tuo account. Per usarlo di nuovo attivalo.';
      actions = btn(CMD.LIC_ACTIVATE, 'Attiva GL-8', true);
      break;
    default:
      title = 'Attiva GL-8';
      text = (
        <>
          Per usare GL-8 serve un account su girolooper8.com (basta la tua email). Se l'hai acquistato funziona per
          sempre; altrimenti parte la prova gratuita di <strong>14 giorni</strong>.
        </>
      );
      actions = btn(CMD.LIC_ACTIVATE, 'Attiva GL-8', true);
  }

  return (
    <div className="lic" role="dialog" aria-label="Licenza GL-8">
      <div className="lic__card">
        <div className="lic__brand">
          GL-8 <span>Giro Looper 8</span>
        </div>
        <h2 className="lic__title">{title}</h2>
        <div className="lic__text">{text}</div>
        {err && lic.st !== 'checking' && <div className="lic__err">{err}</div>}
        {actions && <div className="lic__actions">{actions}</div>}
        <div className="lic__foot">Finché GL-8 non è attivo l'audio delle tracce passa senza modifiche.</div>
      </div>
    </div>
  );
}

// a line in the Memories panel: who is signed in, how many days of trial are left
export function LicenceLine({ state, send }) {
  const lic = state?.lic;
  if (!lic || lic.req !== 1 || lic.st !== 'ok') return null;
  return (
    <div className="lic-line">
      <span>
        Account <strong>{lic.email}</strong>
        {lic.plan === 'trial' ? ` · prova, ${lic.days} ${lic.days === 1 ? 'giorno' : 'giorni'} rimasti` : ' · acquistato'}
      </span>
      <span className="lic-line__actions">
        {lic.plan === 'trial' && (
          <a className="chip" href={`${siteOf(lic)}/account`} target="_blank" rel="noreferrer">
            Acquista
          </a>
        )}
        <HoldButton ms={700} className="chip" onHold={() => send(0, CMD.LIC_SIGN_OUT, 0)}>
          Esci
        </HoldButton>
      </span>
    </div>
  );
}
