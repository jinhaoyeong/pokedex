"use client";

import { useEffect, useRef, useState } from "react";

type SearchSelectOption = {
  label: string;
  value: string;
};

export function SearchSelect({
  name,
  options,
  value,
}: {
  name: string;
  options: SearchSelectOption[];
  value: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value);
  const labelId = `${name}-select-label`;
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption =
    options.find((option) => option.value === selectedValue) ?? options[0] ?? { label: "Select", value: "" };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div ref={rootRef} className="search-select relative min-w-0">
      <input type="hidden" name={name} value={selectedOption.value} />
      <button
        type="button"
        aria-labelledby={labelId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="select-trigger"
      >
        <span id={labelId} className="select-trigger-label">
          {selectedOption.label}
        </span>
        <span className="select-chevron" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="select-menu">
          {options.map((option) => {
            const isSelected = option.value === selectedOption.value;

            return (
              <button
                key={`${name}-${option.value}`}
                type="button"
                onClick={() => {
                  setSelectedValue(option.value);
                  setIsOpen(false);
                }}
                className={`select-option ${isSelected ? "select-option-active" : ""}`}
              >
                <span>{option.label}</span>
                {isSelected ? <span className="select-option-dot" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
