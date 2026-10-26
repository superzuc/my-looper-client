import { useCallback, useEffect, useRef, useState } from 'react';
import { ReaperClient } from '../lib/reaperClient';
import { DemoClient } from '../lib/demoClient';

export function isDemo() {
  return new URLSearchParams(window.location.search).has('demo');
}

// Connects to REAPER (or the demo simulator) and exposes the latest state.
// `receivedAt` (performance.now()) lets components extrapolate the loop position.
export function useLooper() {
  const [state, setState] = useState(null);
  const [conn, setConn] = useState('connecting');
  const receivedAt = useRef(0);
  const clientRef = useRef(null);

  useEffect(() => {
    const Client = isDemo() ? DemoClient : ReaperClient;
    const client = new Client((s, c, at) => {
      if (s) {
        receivedAt.current = at;
        setState(s);
      }
      setConn(c);
    });
    clientRef.current = client;
    client.start();
    return () => client.stop();
  }, []);

  const send = useCallback((target, code, arg = 0) => {
    clientRef.current?.send(target, code, arg);
  }, []);

  return { state, conn, send, receivedAt, client: clientRef };
}

export function livePos(looper, receivedAt, now) {
  if (!looper || !looper.running || !looper.lenSec) return looper ? looper.pos : 0;
  const p = looper.pos + (now - receivedAt) / 1000 / looper.lenSec;
  return p - Math.floor(p);
}
