import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// A short buzz tells a gloved hand the hold registered; ignored where unsupported.
export function buzz(pattern: number | number[] = 35) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is optional feedback.
  }
}

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
      buzz([30, 40, 30]);
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
        // A long press must not open the phone's context menu and cancel the hold.
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          if (event.detail === 0 && !disabled) {
            if (armed) {
              setArmed(false);
              buzz([30, 40, 30]);
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
        {armed ? "Activate again to confirm." : "Hold 1 second or press twice."}
      </small>
    </div>
  );
}
