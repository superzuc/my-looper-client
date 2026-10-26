# MyLooper

Looper a 8 sezioni per REAPER (ispirato a Super8), controllato dall'iPad via Wi-Fi.

```
iPad (Safari)  ──HTTP──▶  web server di REAPER  ──ExtState──▶  MyLooper_bridge.lua  ──gmem──▶  MyLooper.jsfx (1 per traccia)
              ◀──stato──                        ◀──────────────                     ◀────────
```

Non serve nessun server esterno: la pagina la serve REAPER, lo script Lua fa da ponte.

## Contenuto

| File | Cosa fa |
|---|---|
| `reaper/MyLooper.jsfx` | Il motore: 8 sezioni stereo per traccia, modalità Normale/Bar, ½ e ×2 |
| `reaper/MyLooper_bridge.lua` | Il ponte tra iPad e JSFX (assegna gli ID, gira comandi e stato) |
| `reaper/MyLooper_gate.jsfx` | Il gate per gli stacchi sulla drum machine (lo script lo mette da solo sulle sue tracce) |
| `reaper/looper.html` | L'interfaccia già compilata (un solo file) |
| `src/` | Sorgente React dell'interfaccia |

## Installazione (una volta)

1. `npm install`, poi `npm run deploy`. Compila l'interfaccia e copia i 3 file nella cartella risorse di REAPER
   (`%APPDATA%\REAPER`; se è altrove: `set REAPER_RESOURCE_PATH=...`).
2. REAPER → Preferences → Control/OSC/web → **Add** → *Web browser interface*, porta `8080`.
   Consenti l'accesso quando Windows Firewall lo chiede.
3. Su ogni traccia-strumento: aggiungi il JSFX **MyLooper**, arma la traccia e attiva il monitoraggio
   dell'ingresso (oppure record mode "disable – input monitoring only").
4. Il bridge (`Scripts/MyLooper/MyLooper_bridge.lua`) parte da solo con REAPER: `npm run deploy` lo aggiunge a
   `Scripts/__startup.lua`. Solo la prima volta, se REAPER è già aperto, eseguilo a mano da Actions → *Load ReaScript*.
5. Sull'iPad apri `http://<IP del PC>:8080/looper.html`, poi Condividi → **Aggiungi a Home** per averla a
   schermo intero. Disattiva il blocco automatico (Impostazioni → Schermo e luminosità).

## Uso

- **Header**: avvio e stop di REAPER con il BPM, **Play tutti** e **Stop tutti** (agiscono su tutti i looper).
- **Swipe** orizzontale per passare da un looper (traccia) all'altro; l'ordine è quello delle tracce.
- **Normale** = i comandi partono subito. **Bar** = partono alla fine del giro (vedi sotto). Se premi entro 150 ms *dopo* l'inizio del giro, il comando parte comunque su quel giro:
  il REC recupera anche quello che hai suonato da quell'istante (pre-roll) e la fine del REC toglie l'audio in eccesso.
  Lo slider "Late-press grace" del JSFX regola la finestra.
- **Cerchi (8 sezioni)**:
  - tocco breve → play / pausa (se stai registrando: chiude il rec e va in play)
  - **doppio tocco** → play / pausa **subito**, senza aspettare la fine della bar (anche in modalità Bar)
  - tieni premuto **0,8 s** → rec (take nuova se la sezione è ferma, overdub se sta suonando)
  - tocco, poi secondo tocco tenuto 0,8 s → **rec silenziosa** (vedi sotto)
  - tocco su un cerchio "in attesa" (anello tratteggiato) → annulla il comando
  - per distinguere il doppio tocco, il tocco singolo parte dopo 250 ms; in modalità Bar il JSFX allarga la
    finestra di tolleranza di quel tanto, quindi il comando resta a tempo
- **Sezione N** (chip nella barra dello strumento): sceglie la sezione su cui agiscono ½ / ×2, **Kill**, il mixer,
  i fade e gli effetti. Ogni tocco passa alla sezione registrata successiva, dopo l'ultima torna a "nessuna".
- **½ / ×2 ("prossima rec")**: scelgono la lunghezza della **prossima take**. Le sezioni già registrate tengono la
  loro lunghezza (la vedi sotto il numero del cerchio), quindi nello stesso looper puoi avere una sezione da 1 bar e
  una da 2 bar che girano insieme, allineate alla timeline.
- ½ / ×2 su una **sezione selezionata** (chip Sezione) non perdono audio: dimezzando si tiene tutta la take, e raddoppiando si
  ritrova la parte nascosta. Se raddoppi oltre la lunghezza registrata, il loop si ripete.
- In modalità **Bar** una take nuova parte sul prossimo multiplo della lunghezza scelta; play, pausa, fine rec e
  overdub aspettano la fine del giro *di quella sezione*.
- **Svuota** (tieni premuto 1 s): cancella tutte le sezioni del looper.
- **↶ Undo / ↷ Redo**: annulla (e ripristina) l'ultima registrazione del looper, sia take nuova che overdub.
  C'è un livello per looper, come su una loop station: una nuova rec prende il posto del vecchio undo.
- **Mixer della sezione selezionata**: mute, volume (con aggancio a 0 dB) e pan, oltre a Reset.
  Una sezione muta continua a girare a tempo e il cerchio mostra "Muto".
- **Rec silenziosa (cue)**: tocco, poi **secondo tocco tenuto 0,8 s**. Solo durante la registrazione quello che suoni
  passa sul bus cue e sparisce dal master, quindi il pubblico non sente niente. Il tocco che la chiude la ferma
  **subito** (non c'è motivo di aspettare la bar: finisce in pausa comunque) e la sezione torna una sezione normale
  sul main: un tocco e parte per tutti.
- Il pulsante **In cuffia / In main** nella striscia mixer sposta a mano una sezione tra bus cue e master, se ti serve
  riascoltarne una solo tu.
- **Griglia** (nell'header): mostra tutti i looper insieme, una riga per strumento con le sue 8 sezioni. I gesti sono
  gli stessi dei cerchi (tocco = play / pausa, 0,8 s = rec, tocco + tenuto = rec silenziosa) e ogni riga ha ▶ / ❚❚
  per il suo strumento, così puoi far partire o fermare sezioni di strumenti diversi senza cambiare pagina.
  *Strumenti* torna alla vista con lo swipe (la selezione col doppio tocco e il mixer stanno solo lì).
- **Fade in / Fade out** (nell'header): **▲** sfuma in entrata e **▼** in uscita, su **tutti** i looper.
  Accanto c'è la lunghezza con **½ / ×2** come per la rec: **½, 1, 2, 4, 8, 16, 32 bar**, da impostare *prima*
  di premere (toccando il numero si apre l'elenco intero; da telefono ½ e ×2 sono nascosti e resta l'elenco).
  Il fade **in** fa ripartire le sezioni che hanno contenuto e le porta su da zero; il fade **out** finisce con
  tutto in pausa. Funzionano **solo in modalità Bar** e una seconda pressione annulla.
- **Fade di uno strumento o di una sola sezione**: i chip **▲ In** e **▼ Out** nella barra dello strumento
  agiscono sul looper, oppure sulla **sezione selezionata** se ne hai scelta una col chip *Sezione*.
  Nella Griglia ogni riga ha i suoi ▲ / ▼ per quello strumento. Mentre scende (o sale) il cerchio si smorza.
- **FX** (nell'header o nella barra dello strumento): filtro da DJ e kill a 3 bande.
  - il **filtro** è la manopola classica: a sinistra passa-basso (fino a 80 Hz), a destra passa-alto (fino a
    4 kHz), al centro aperto. *centro* lo riporta a zero.
  - **Bassi / Medi / Alti** vanno da 0 (kill) a 200 %; il tasto **Kill** azzera e ripristina la banda.
  - in cima scegli su cosa agisce: **Generale** (tutti gli strumenti), un singolo strumento, oppure una sua
    sezione. Il pulsante FX della barra si apre già sulla sezione selezionata.
  - non tocca il monitoraggio dell'ingresso: quello che suoni dal vivo resta pulito.
- **Drum** (nell'header): mette in pausa e fa ripartire la sola drum machine, **a fine bar**, senza toccare il
  transport di REAPER. In pratica muta le sue tracce: la macchina continua a girare sul clock MIDI, quindi quando
  rientra è esattamente dove i loop se l'aspettano. Il bridge la cerca per nome (una traccia che contiene "drum");
  se non ne trova usa le tracce 4 e 5 — si cambia in cima a `MyLooper_bridge.lua` (`DRUM_NAME`, `DRUM_TRACKS`).
  Una seconda pressione prima della fine del giro annulla.
- **Lunghezza scritta a mano**: tocca il numero dentro lo stepper *prossima rec* (o della sezione selezionata) e
  scrivi quante bar vuoi. Serve quando il ×2 non ci arriva: salta da 8 a 16 e 16 può non entrare in memoria, mentre
  12 sì. La finestrella dice il massimo possibile con il tempo attuale. Anche la lunghezza del fade si può scrivere
  (voce *scrivi* nell'elenco), fino a 64 bar.
- **Scaletta** (nell'header): il pezzo scritto prima, così dal vivo non devi premere tu.
  - griglia con le **bar in orizzontale** e le righe in verticale: *Generale* più una riga per ogni strumento
    (`+ riga`) o per ogni sua sezione. Tocchi una casella e scegli cosa succede a quella bar.
  - eventi: **rec**, **rec in cuffia**, **play**, **pausa**, **play/stop di tutte** le sezioni di uno strumento,
    **fade in / out** (con la loro lunghezza), **filtro** e **bassi/medi/alti**, **drum machine** in play o in pausa,
    **cambio di BPM**, e **attesa**.
  - **attesa**: la scaletta arriva lì, tiene tutto com'è e riparte solo quando tocchi *Continua*. Mettine una dove
    vuoi allungare un giro o aspettare il pubblico: tutto quello che viene dopo si sposta in avanti di conseguenza.
  - **Avvia** fa partire la scaletta dalla **prossima stanghetta** e conta le bar da lì; sopra vedi la bar corrente
    e il prossimo evento, e la colonna della bar in corso è evidenziata.
  - **8 slot** salvati nella cartella del progetto (`MyLooper/scalette/`), con nome e numero di eventi.
  - rec, play e pausa non le manda lo script: le **prenota nel JSFX con il beat esatto**, quindi cadono sul campione
    giusto come se le premessi tu (la correzione del ritardo recupera anche il pre-roll della rec).
  - **stacco**: silenzio dentro la bar. Scegli **da dove** (gli ottavi della bar: 1, e, 2, e…) e **quanto dura**
    (1/8 … 7/8, 1 o 2 bar). Sotto la musica continua a girare, quindi quando lo stacco finisce tutto riparte
    esattamente a tempo, senza toccare play/pausa. Sulla riga di una sezione tace quella sezione, sulla riga
    *tutto* di uno strumento tace lo strumento, su *Generale* tacciono tutti i looper e (con la spunta) anche la
    drum machine. È prenotato nel JSFX al campione, con una rampa di 4 ms per non fare click. Per la drum serve
    `MyLooper_gate.jsfx` sulle sue tracce: lo script lo aggiunge da solo alla prima scaletta che ne ha bisogno.
  - **pattern drum** (su *Generale*): manda alla UNO Drum il cambio di pattern (SysEx sulla sua uscita MIDI,
    `F0 00 21 1A 02 02 35 00 <n> F7`). Nel riquadro *Drum machine* sotto la griglia puoi provare un pattern al volo,
    correggere la numerazione se arriva a quello dopo, e scegliere se mandare il cambio sulla stanghetta o un po'
    prima (se la UNO aspetta la fine del suo pattern prima di cambiare).
  - **filtro / bassi / medi / alti** con **transizione**: dopo il valore scegli *Subito* oppure *in ½ … 32 bar*,
    e la manopola ci arriva gradualmente partendo dalla bar dell'evento (la fa il JSFX, a tempo). Su *Generale* vale
    per tutti gli strumenti. Se tocchi quella manopola a mano la transizione si ferma.
  - **suono synth** (su *Generale*): alla bar scelta la traccia *synth* passa a un altro suono di Splice INSTRUMENT
    (o LABS). I suoni sono preset di REAPER del plugin: nel riquadro *Synth* sotto la griglia scegli uno strumento in
    Splice e tocchi **Salva il suono attuale** (il nome lo prende dallo strumento), poi lo trovi nell'elenco della
    scaletta. Da lì puoi anche caricarli a mano o toglierli. Cambia solo il plugin: il looper sulla stessa traccia non
    si tocca. Il cambio carica dei campioni, quindi mettilo dove il synth non suona.
  - mentre gira puoi sempre intervenire a mano con i pulsanti: la scaletta non blocca niente.
- **Drum a tempo**: se REAPER ha un buco audio la drum machine può perdere dei tick del MIDI clock e finire fuori
  dalla bar. *Tieni premuto Drum* (o *Rimettila a tempo* nel riquadro Drum machine della scaletta): alla prossima
  bar utile `MyLooper_gate.jsfx` manda alla UNO Stop + Start mezzo tick prima della stanghetta, così riparte il
  pattern esattamente sull'1. La bar utile è un multiplo della lunghezza del pattern (1/2/4/8 bar, contate dall'inizio
  del progetto). Di default lo fa **da solo** dopo ogni buco audio che REAPER segnala. Lo script mette il gate sulle
  tracce drum e manda l'uscita MIDI della prima traccia drum alla UNO (solo se non ne aveva già una).
- **Memorie** (nell'header): 8 slot che salvano tutti i looper nella cartella del progetto
  (`MyLooper/memN/`, un WAV float per sezione più `mem.txt` con lunghezze, volume, pan e mute).
  Per caricare tieni premuto *Carica*: svuota i looper coinvolti, riporta il tempo a quello salvato e lascia
  le sezioni in pausa. I looper vengono abbinati per nome della traccia, altrimenti per posizione.

## Bus cue (uscite 3/4)

Il JSFX ha quattro uscite: Main L/R e **Cue L/R**. Le sezioni marcate CUE e il monitoraggio dell'ingresso durante una
rec silenziosa vanno sulle 3/4 invece che sulle 1/2.

- Con la traccia a 2 canali (come di default) una sezione in cue è semplicemente **muta**: ti senti suonare dal mixer,
  e il loop resta fuori dalla sala finché non premi *In main*.
- Per sentirla davvero in cuffia: porta la traccia a **4 canali** (Route → Track channels: 4) e manda i canali 3/4
  dove arriva il tuo in-ear (per esempio una traccia CUE che esce su una coppia di uscite dedicata).

Il transport di REAPER deve essere in play (le posizioni seguono la timeline, così tutte le tracce restano
allineate). Se è fermo, il primo rec o play lo avvia da solo (`AUTO_TRANSPORT` nello script Lua).

## Sviluppo

- `npm start`: dev server su `:3000`, con proxy verso REAPER su `:8080` (raggiungibile anche dall'iPad).
- `http://localhost:3000/?demo`: simulatore senza REAPER.
- `npm run build:reaper`: genera `build/looper.html`. `npm run deploy` genera e copia.

Protocollo (codici comando, layout gmem): vedi l'intestazione di `reaper/MyLooper.jsfx` e `src/lib/protocol.js`.
