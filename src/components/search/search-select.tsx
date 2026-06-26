"use client";

import { useEffect, useId, useRef, useState } from "react";

type SearchSelectOption = {
  label: string;
  value: string;
};

export function SearchSelect({
  ariaLabel,
  disabled = false,
  labelledBy,
  name,
  onChange,
  options,
  value,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  labelledBy?: string;
  name: string;
  onChange?: (value: string) => void;
  options: SearchSelectOption[];
  value: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fallbackLabelId = useId();
  const labelId = labelledBy ?? fallbackLabelId;
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0] ?? { label: "Select", value: "" };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("click", closeOnOutsideClick);
    return () => document.removeEventListener("click", closeOnOutsideClick);
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className="search-select relative min-w-0"
      data-open={isOpen ? "true" : "false"}
    >
      <input type="hidden" name={name} value={selectedOption.value} />
      <button
        type="button"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy ? undefined : labelId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className="select-trigger"
      >
        <span id={labelledBy ? undefined : labelId} className="select-trigger-label">
          {selectedOption.label}
        </span>
        <span className="select-chevron" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="select-menu" role="listbox" aria-label={ariaLabel ?? name}>
          {options.map((option, index) => {
            const isSelected = option.value === selectedOption.value;

            return (
              <button
                key={`${name}-${option.value || "all"}-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setIsOpen(false);
                  onChange?.(option.value);
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
