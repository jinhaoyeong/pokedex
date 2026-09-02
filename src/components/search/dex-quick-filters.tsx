"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type QuickFilterOption = {
  value: string;
  label: string;
};

export type QuickFilterGroup = {
  key: string;
  /** Chip label, e.g. "Sort". */
  label: string;
  /** Current selection printed on the chip. */
  valueLabel: string;
  value: string;
  isDefault: boolean;
  disabled?: boolean;
  /** Long option lists (sets) get a type-to-narrow field in the sheet. */
  searchable?: boolean;
  options: QuickFilterOption[];
  onChange: (value: string) => void;
};

function subscribeMounted() {
  return () => {};
}

function getMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

function optionMatches(option: QuickFilterOption, needle: string) {
  return option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
}

/**
 * Phone filter rail. Every filter prints its current value on a chip, so a
 * narrowed browse is legible without opening anything, and one tap puts the
 * options in a thumb-reachable sheet instead of a drawer that pushes the
 * results down the page.
 */
export function DexQuickFilters({
  groups,
  scan,
}: {
  groups: QuickFilterGroup[];
  scan?: ReactNode;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const mounted = useSyncExternalStore(subscribeMounted, getMounted, getServerMounted);
  const openGroup = groups.find((group) => group.key === openKey) ?? null;

  useEffect(() => {
    if (!openGroup) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenKey(null);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openGroup]);

  const close = () => {
    setOpenKey(null);
    setFilterText("");
  };

  const needle = filterText.trim().toLowerCase();
  const visibleOptions =
    openGroup && needle
      ? openGroup.options.filter((option) => optionMatches(option, needle))
      : (openGroup?.options ?? []);

  const sheet = openGroup ? (
    <div className="dex-sheet-layer">
      <button
        type="button"
        className="dex-sheet-scrim"
        aria-label={`Close ${openGroup.label.toLowerCase()} options`}
        onClick={close}
      />
      <div
        className="dex-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${openGroup.label} options`}
      >
        <header className="dex-sheet-head">
          <span className="dex-sheet-grip" aria-hidden />
          <p className="dex-sheet-title">{openGroup.label}</p>
          <button type="button" className="dex-sheet-close" onClick={close}>
            Done
          </button>
        </header>

        {openGroup.searchable ? (
          <div className="dex-sheet-search">
            <input
              type="text"
              value={filterText}
              autoComplete="off"
              placeholder={`Find a ${openGroup.label.toLowerCase()}`}
              className="form-input dex-sheet-search-input"
              onChange={(event) => setFilterText(event.target.value)}
            />
          </div>
        ) : null}

        <div className="dex-sheet-options" role="listbox" aria-label={openGroup.label}>
          {visibleOptions.length ? (
            visibleOptions.map((option) => {
              const selected = option.value === openGroup.value;

              return (
                <button
                  key={`${openGroup.key}-${option.value || "all"}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-selected={selected || undefined}
                  className="dex-sheet-option"
                  onClick={() => {
                    close();
                    if (!selected) {
                      openGroup.onChange(option.value);
                    }
                  }}
                >
                  <span className="dex-sheet-option-label">{option.label}</span>
                  {selected ? <span className="dex-sheet-tick" aria-hidden /> : null}
                </button>
              );
            })
          ) : (
            <p className="dex-sheet-empty">No match for “{filterText.trim()}”.</p>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="dex-quick-rail" role="group" aria-label="Dex filters">
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          className="dex-quick-chip"
          data-active={group.isDefault ? undefined : ""}
          disabled={group.disabled}
          aria-haspopup="dialog"
          aria-expanded={openKey === group.key}
          onClick={() => {
            setFilterText("");
            setOpenKey((current) => (current === group.key ? null : group.key));
          }}
        >
          <span className="dex-quick-chip-label">{group.label}</span>
          <span className="dex-quick-chip-value">{group.valueLabel}</span>
          <span className="dex-quick-chip-caret" aria-hidden />
        </button>
      ))}
      {scan ? <span className="dex-quick-scan">{scan}</span> : null}
      {mounted && sheet ? createPortal(sheet, document.body) : null}
    </div>
  );
}
