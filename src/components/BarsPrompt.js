import { useEffect, useRef, useState } from 'react';

// Scrivi il numero di bar a mano, per quando ½ e ×2 non ci arrivano
// (es. 12 bar: ×2 salterebbe da 8 a 16 e 16 non ci sta in memoria).
export default function BarsPrompt({ value, min = 0.5, max = 64, quick = [], unit = 'bar', title, onOk, onClose }) {
  const [txt, setTxt] = useState(String(value));
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const confirm = (v) => {
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) return onClose();
    onOk(Math.min(max, Math.max(min, n)));
  };

  return (
    <div className="show-pick" onClick={onClose}>
      <div className="show-pick__box bars-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="show-pick__head">
          <strong>{title || 'Quante bar?'}</strong>
          <span className="muted">
            {' '}
            da {min} a {max} {unit}
          </span>
        </div>
        <div className="bars-prompt__row">
          <input
            ref={ref}
            className="show-name"
            type="number"
            inputMode="decimal"
            step="0.5"
            min={min}
            max={max}
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirm(txt)}
          />
          <button type="button" className="chip chip--ok" onClick={() => confirm(txt)}>
            Metti
          </button>
        </div>
        {quick.length > 0 && (
          <div className="show-pick__grid">
            {quick
              .filter((q) => q <= max && q >= min)
              .map((q) => (
                <button key={q} type="button" className="chip" onClick={() => confirm(q)}>
                  {q} {unit}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
