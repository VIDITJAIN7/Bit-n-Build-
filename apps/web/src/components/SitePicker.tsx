import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Site } from "../types";

export function SitePicker({
  sites,
  value,
  onChange,
}: {
  sites: Site[];
  value: string;
  onChange: (siteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = sites.find((site) => site.id === value);
  const items = [
    { id: "all", name: "All sites" },
    ...sites.map((site) => ({ id: site.id, name: site.name })),
  ];

  useEffect(() => {
    if (!open) return;
    options.current[items.findIndex((item) => item.id === value)]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, value, items.length]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const current = options.current.findIndex(
      (option) => option === document.activeElement,
    );
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1 + items.length) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    } else return;
    event.preventDefault();
    options.current[next]?.focus();
  }

  return (
    <div className="worker-site-picker" ref={root}>
      <button
        ref={trigger}
        className="worker-site-trigger"
        type="button"
        aria-label="Choose work site"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="worker-site-menu"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selected?.name ?? "All sites"}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          id="worker-site-menu"
          className="worker-site-menu"
          role="menu"
          aria-label="Work site"
          onKeyDown={moveFocus}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                options.current[index] = element;
              }}
              className="worker-site-option"
              type="button"
              role="menuitemradio"
              aria-checked={value === item.id}
              onClick={() => {
                onChange(item.id);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <span>{item.name}</span>
              {value === item.id && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
