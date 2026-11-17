import { useState } from 'react';
import { ALL_LOOPERS, CMD, machineArg } from '../lib/protocol';

// Plug-in (Ableton) only: the machines (drum machines, grooveboxes, synths) the scaletta
// drives, and the MIDI mapping that lets the iPad press play / stop and set the BPM.

const LEADS = [
  { v: 0, label: 'Sulla stanghetta' },
  { v: 1, label: '1/8 prima' },
  { v: 2, label: '1/4 prima' },
  { v: 4, label: '1/2 bar prima' },
];
const clean = (s) => String(s || '').replace(/[|\r\n"\\]/g, ' ').slice(0, 40);
const baseOfs = (pat) => (pat === 'pc' ? 1 : 0);   // pattern 1 = program 0, UNO: byte = pattern

function Select({ value, onChange, children }) {
  return (
    <select className="mbox__sel" value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

function AbletonBox({ state, send, client }) {
  const ctl = state?.ctl || {};
  const outs = state?.midiOuts || [];
  const [port, setPort] = useState(ctl.port || '');
  const [ch, setCh] = useState(ctl.ch || 16);
  const [min, setMin] = useState(ctl.min || 60);
  const [max, setMax] = useState(ctl.max || 200);
  const [bpm, setBpm] = useState(Math.round(state?.tempo || 120));
  const [msg, setMsg] = useState('');
  const [alt, setAlt] = useState(!!ctl.port);
  const live = state?.live || {};
  const canTempo = live.on || ctl.ok;
  const save = async () => {
    try {
      await client.setExt('ctlcfg', `${clean(port)}|${ch}|${min}|${max}`);
      send(ALL_LOOPERS, CMD.CTL_SET);
      setMsg('Salvato');
    } catch {
      setMsg('Non riesco a mandarlo al plugin');
    }
    setTimeout(() => setMsg(''), 2500);
  };
  return (
    <div className="drumbox mbox">
      <div className="drumbox__row">
        <strong>Ableton: play, stop e BPM</strong>
        <span className={live.on ? 'mbox__ok' : 'muted'}>
          {live.on ? '✓ collegato (Remote Script GL8)' : ctl.ok ? `via MIDI mapping (${ctl.port})` : 'non collegato'}
        </span>
      </div>
      {!live.on && (
        <div className="muted mbox__help">
          {live.installed ? (
            <>
              Il plugin ha già messo lo script in Ableton. Una volta sola: <strong>riavvia Ableton</strong>, poi
              Preferenze → Link, Tempo & MIDI → <em>Control Surface</em>: scegli <strong>GL8</strong>, Input e
              Output: Nessuno.
            </>
          ) : (
            live.err || 'Lo script per Ableton non è stato installato.'
          )}
        </div>
      )}
      <div className="drumbox__row">
        <span>BPM adesso</span>
        <input className="show-name drumbox__num" type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
        <button type="button" className="chip chip--sm" disabled={!canTempo} onClick={() => send(ALL_LOOPERS, CMD.TEMPO, Math.round(bpm * 100))}>
          Imposta
        </button>
        <button type="button" className={`chip chip--sm ${alt ? 'is-on' : ''}`} onClick={() => setAlt((a) => !a)}>
          In alternativa: MIDI mapping {alt ? '▴' : '▾'}
        </button>
      </div>
      {alt && (<>
      <div className="drumbox__row">
        <span>Porta virtuale</span>
        <Select value={port} onChange={setPort}>
          <option value="">— nessuna —</option>
          {outs.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
        <span>canale</span>
        <Select value={ch} onChange={(v) => setCh(Number(v))}>
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i + 1}>{i + 1}</option>
          ))}
        </Select>
        <span>BPM da</span>
        <input className="show-name drumbox__num" type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} />
        <span>a</span>
        <input className="show-name drumbox__num" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} />
        <button type="button" className="chip chip--sm chip--ok" onClick={save}>Salva</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <div className="drumbox__row">
        <span>Per la mappatura</span>
        <button type="button" className="chip chip--sm" onClick={() => send(ALL_LOOPERS, CMD.CTL_LEARN, 1)}>Manda Play</button>
        <button type="button" className="chip chip--sm" onClick={() => send(ALL_LOOPERS, CMD.CTL_LEARN, 2)}>Manda Stop</button>
        <button type="button" className="chip chip--sm" onClick={() => send(ALL_LOOPERS, CMD.CTL_LEARN, 3)}>Manda BPM</button>
      </div>
      <div className="muted mbox__help">
        Una volta sola: in Ableton, Preferenze → Link/Tempo/MIDI, sulla porta virtuale in <em>Ingresso</em> accendi
        <em> Remote</em>. Poi MIDI Map (Ctrl+M): clicca Play e tocca "Manda Play", clicca Stop e "Manda Stop", clicca il
        BPM e "Manda BPM"; per il BPM nel pannello della mappatura metti Mode <em>Absolute (14-bit)</em>, Min {min} e
        Max {max}. Esci da MIDI Map. Serve un programma per la porta virtuale (loopMIDI); con il Remote Script no.
      </div>
      </>)}
    </div>
  );
}

function MachineCard({ m, state, send, client }) {
  const outs = state?.midiOuts || [];
  const tracks = state?.drumTracks || [];
  const [f, setF] = useState({ name: m.name, track: m.track, port: m.port, ch: m.ch, pat: m.pat, lead: m.lead, ofs: m.ofs, ss: m.ss });
  const [n, setN] = useState(m.last || 1);
  const [msg, setMsg] = useState('');
  const [del, setDel] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const dirty = ['name', 'track', 'port', 'ch', 'pat', 'lead', 'ofs', 'ss'].some((k) => String(f[k]) !== String(m[k]));
  const save = async () => {
    try {
      await client.setExt('mcfg', `${m.id}|${clean(f.name)}|${clean(f.track)}|${clean(f.port)}|${f.ch}|${f.pat}|${f.lead}|${f.ofs}|${f.ss ? 1 : 0}`);
      send(ALL_LOOPERS, CMD.MACHINE_SET);
      setMsg('Salvata');
    } catch {
      setMsg('Non riesco a mandarla al plugin');
    }
    setTimeout(() => setMsg(''), 2500);
  };
  const base = baseOfs(f.pat);
  const go = (code, v) => send(ALL_LOOPERS, code, machineArg(m.id, v));
  return (
    <div className="mcard">
      <div className="drumbox__row">
        <input className="show-name mcard__name" value={f.name} onChange={(e) => set('name', e.target.value)} />
        <span className="muted">
          {m.gates > 0 ? (m.pend >= 0 ? (m.pend ? 'si spegne alla bar' : 'si accende alla bar') : m.mute ? 'spenta' : 'accesa')
            : 'solo MIDI'}
          {m.last > 0 ? ` · ultimo pattern ${m.last}` : ''}
          {m.run === 1 ? ' · in start' : m.run === 0 ? ' · in stop' : ''}
        </span>
      </div>
      {m.err && <div className="show-warn">{m.err}</div>}
      <div className="drumbox__row">
        <span>Traccia</span>
        <Select value={f.track} onChange={(v) => set('track', v)}>
          <option value="">— nessuna (solo MIDI) —</option>
          {[...new Set([f.track, ...tracks].filter(Boolean))].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <span>MIDI</span>
        <Select value={f.port} onChange={(v) => set('port', v)}>
          <option value="">— nessuna —</option>
          {[...new Set([f.port, ...outs].filter(Boolean))].map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
        <span>canale</span>
        <Select value={f.ch} onChange={(v) => set('ch', Number(v))}>
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i + 1}>{i + 1}</option>
          ))}
        </Select>
      </div>
      <div className="drumbox__row">
        <span>Pattern con</span>
        {[['pc', 'Program Change'], ['uno', 'SysEx UNO'], ['', 'niente']].map(([k, label]) => (
          <button key={k} type="button" className={`chip chip--sm ${f.pat === k ? 'is-on' : ''}`}
            onClick={() => setF((x) => ({ ...x, pat: k, ofs: baseOfs(k) }))}>
            {label}
          </button>
        ))}
      </div>
      {f.pat && (
        <div className="drumbox__row">
          <span>Numerazione</span>
          <button type="button" className={`chip chip--sm ${f.ofs === base ? 'is-on' : ''}`} onClick={() => set('ofs', base)}>Normale</button>
          <button type="button" className={`chip chip--sm ${f.ofs === base + 1 ? 'is-on' : ''}`} onClick={() => set('ofs', base + 1)}>
            −1 (se va a quello dopo)
          </button>
          <button type="button" className={`chip chip--sm ${f.ofs === base - 1 ? 'is-on' : ''}`} onClick={() => set('ofs', base - 1)}>
            +1 (se va a quello prima)
          </button>
        </div>
      )}
      {f.pat && (
        <div className="drumbox__row">
          <span>Cambio pattern</span>
          {LEADS.map((x) => (
            <button key={x.v} type="button" className={`chip chip--sm ${f.lead === x.v ? 'is-on' : ''}`} onClick={() => set('lead', x.v)}>
              {x.label}
            </button>
          ))}
        </div>
      )}
      <div className="drumbox__row">
        <span>Start / Stop MIDI dalla scaletta</span>
        <button type="button" className={`chip chip--sm ${f.ss ? 'is-on' : ''}`} onClick={() => set('ss', true)}>Sì</button>
        <button type="button" className={`chip chip--sm ${!f.ss ? 'is-on' : ''}`} onClick={() => set('ss', false)}>No</button>
        <button type="button" className="chip chip--sm chip--ok" disabled={!dirty} onClick={save}>Salva</button>
        {msg && <span className="muted">{msg}</span>}
        {!del ? (
          <button type="button" className="chip chip--sm" onClick={() => setDel(true)}>Togli</button>
        ) : (
          <button type="button" className="chip chip--sm chip--danger" onClick={() => send(ALL_LOOPERS, CMD.MACHINE_DEL, m.id)}>
            Sicuro? Togli {m.name}
          </button>
        )}
      </div>
      <div className="drumbox__row">
        <span>Prova</span>
        {m.gates > 0 && (
          <button type="button" className={`chip chip--sm ${m.pend >= 0 ? 'is-pending' : ''}`} onClick={() => go(CMD.MACHINE_ONOFF, 2)}>
            {m.mute ? 'Accendi' : 'Spegni'} (alla bar)
          </button>
        )}
        <button type="button" className="chip chip--sm" disabled={!m.port} onClick={() => go(CMD.MACHINE_RUN, 2)}>Start</button>
        <button type="button" className="chip chip--sm" disabled={!m.port} onClick={() => go(CMD.MACHINE_RUN, 3)}>Stop</button>
        <input className="show-name drumbox__num" type="number" min="1" max="128" value={n} onChange={(e) => setN(Number(e.target.value))} />
        <button type="button" className="chip chip--sm" disabled={!m.port || !m.pat} onClick={() => go(CMD.MACHINE_PATTERN, Math.max(1, Math.min(128, n || 1)))}>
          Pattern
        </button>
        <button type="button" className={`chip chip--sm ${m.sync ? 'is-on' : ''}`} disabled={!m.port} onClick={() => send(ALL_LOOPERS, CMD.MACHINE_SYNC, m.id)}>
          {m.sync ? `Alla bar ${m.sync}… (annulla)` : 'Rimettila a tempo'}
        </button>
      </div>
    </div>
  );
}

export default function MachinesBox({ state, send, client }) {
  const machines = state?.machines || [];
  const add = async () => {
    try {
      await client.setExt('mcfg', `0|Macchina ${machines.length + 1}||||10|pc|0|1|1`);
      send(ALL_LOOPERS, CMD.MACHINE_SET);
    } catch {
      // the next poll shows nothing changed
    }
  };
  return (
    <>
      <AbletonBox state={state} send={send} client={client} />
      <div className="drumbox mbox">
        <div className="drumbox__row">
          <strong>Macchine</strong>
          <span className="muted">
            ogni traccia con GL-8 Drum diventa una macchina; nella scaletta aggiungi la sua riga con "+ riga"
          </span>
        </div>
        {machines.map((m) => (
          <MachineCard key={`${m.id}:${m.name}:${m.port}:${m.track}:${m.pat}:${m.ch}:${m.ofs}:${m.lead}:${m.ss}`} m={m} state={state} send={send} client={client} />
        ))}
        <div className="drumbox__row">
          <button type="button" className="chip chip--sm" onClick={add}>+ Aggiungi una macchina (solo MIDI)</button>
        </div>
        <div className="muted mbox__help">
          Per il MIDI la porta della macchina deve poter essere usata anche da Ableton (che le manda il clock): con
          Windows 11 aggiornato (Windows MIDI Services) va, altrimenti la porta risulta occupata.
        </div>
      </div>
    </>
  );
}
