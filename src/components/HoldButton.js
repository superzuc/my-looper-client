import { useRef, useState } from 'react';

// Button that fires onHold after `ms` of continuous pressing (with a progress bar),
// and optionally onTap for a short press.
export default function HoldButton({ ms = 1000, onHold, onTap, className = '', children, disabled }) {
  const timer = useRef(null);
  const fired = useRef(false);
  const [holding, setHolding] = useState(false);

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    fired.current = false;
    setHolding(true);
    timer.current = setTimeout(() => {
      fired.current = true;
      setHolding(false);
      onHold && onHold();
    }, ms);
  };
  const end = () => {
    clearTimeout(timer.current);
    if (holding && !fired.current && onTap) onTap();
    setHolding(false);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      type="button"
      className={`hold-btn ${holding ? 'is-holding' : ''} ${className}`}
      style={{ '--hold-ms': `${ms}ms` }}
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      disabled={disabled}
    >
      <span className="hold-btn__fill" />
      <span className="hold-btn__label">{children}</span>
    </button>
  );
}
