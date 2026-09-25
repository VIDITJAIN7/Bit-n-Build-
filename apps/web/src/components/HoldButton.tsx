import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export function HoldButton({
  onConfirm,
  disabled,
  children,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function start() {
    if (disabled) return;
    cancel();
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      setArmed(false);
      onConfirm();
    }, 1000);
  }
  return (
    <div className="hold-control">
      <button
        className={`button primary hold-button ${holding ? "holding" : ""}`}
        disabled={disabled}
        onPointerDown={(event) => {
          if (event.button === 0) {
            event.currentTarget.setPointerCapture(event.pointerId);
            start();
          }
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onClick={(event) => {
          if (event.detail === 0 && !disabled) {
            if (armed) {
              setArmed(false);
              onConfirm();
            } else setArmed(true);
          }
        }}
        onBlur={() => {
          cancel();
          setArmed(false);
        }}
      >
        <span>{armed ? "Press again to confirm" : children}</span>
      </button>
      <small>
        {armed
          ? "Review the action, then activate again."
          : "Hold 1 second · Keyboard: activate twice"}
      </small>
    </div>
  );
}
