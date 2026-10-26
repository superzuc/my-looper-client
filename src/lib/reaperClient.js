// Talks to REAPER's built-in web server (Preferences > Control/OSC/web > Web browser interface).
// Commands are written to ExtState "MyLooper/cmd", state is read from ExtState "MyLooper/state".
// Both happen in the same HTTP request: /_/SET/EXTSTATE/...;GET/EXTSTATE/...

const SECTION = 'MyLooper';
const POLL_MS = 60;

function unescapeReaper(v) {
  return v.replace(/\\(.)/g, (_, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));
}

export class ReaperClient {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.session = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x') || 'web';
    this.seq = 0;
    this.pending = [];      // commands not yet acknowledged by the bridge
    this.inFlight = false;
    this.again = false;
    this.stopped = false;
    this.lastOk = 0;
    this.lastTick = null;
    this.lastTickChange = 0;
    this.timer = null;
  }

  start() {
    this.stopped = false;
    this.loop();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  // The scaletta is too big for the command channel: it goes in its own ExtState
  // key, then a command tells the bridge to read it.
  async setShow(text) {
    const res = await fetch(`/_/SET/EXTSTATE/${SECTION}/show/${encodeURIComponent(text)}`, {
      cache: 'no-store',
      method: 'GET',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // what the bridge loaded from disk, so the editor can show it
  async getShow() {
    const res = await fetch(`/_/GET/EXTSTATE/${SECTION}/showdata`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith(`EXTSTATE\t${SECTION}\tshowdata\t`));
    return line ? unescapeReaper(line.split('\t').slice(3).join('\t')) : '';
  }

  send(target, code, arg = 0) {
    this.pending.push({ seq: ++this.seq, target, code, arg });
    if (this.pending.length > 40) this.pending.shift();
    this.request();
  }

  loop() {
    if (this.stopped) return;
    this.request().finally(() => {
      if (!this.stopped) this.timer = setTimeout(() => this.loop(), POLL_MS);
    });
  }

  async request() {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    try {
      let path = '';
      if (this.pending.length) {
        const list = this.pending.map((c) => `${c.seq}.${c.target}.${c.code}.${c.arg}`).join('_');
        path += `SET/EXTSTATE/${SECTION}/cmd/${this.session}~${list};`;
      }
      path += `GET/EXTSTATE/${SECTION}/state`;
      const res = await fetch(`/_/${path}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      this.lastOk = Date.now();
      this.handleResponse(text);
    } catch (e) {
      this.emit(null);
    } finally {
      this.inFlight = false;
      if (this.again) {
        this.again = false;
        this.request();
      }
    }
  }

  handleResponse(text) {
    const line = text
      .split('\n')
      .find((l) => l.startsWith(`EXTSTATE\t${SECTION}\tstate\t`));
    if (!line) return this.emit(null, 'nobridge');
    const raw = unescapeReaper(line.split('\t').slice(3).join('\t'));
    if (!raw) return this.emit(null, 'nobridge');
    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    if (state.t !== this.lastTick) {
      this.lastTick = state.t;
      this.lastTickChange = now;
    }
    if (now - this.lastTickChange > 2000) return this.emit(state, 'nobridge');
    if (state.sess === this.session) {
      this.pending = this.pending.filter((c) => c.seq > state.ack);
    }
    this.emit(state, 'ok');
  }

  emit(state, status) {
    const conn = status || (Date.now() - this.lastOk > 1500 ? 'offline' : 'ok');
    this.onUpdate(state, conn, performance.now());
  }
}
