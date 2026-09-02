"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { APP_SCROLL_ROOT_ID } from "@/lib/app-scroll";

export type QuickFilterOption = {
  value: string;
  label: string;
};

export type QuickFilterGroup = {
  key: string;
  /** Sheet title, e.g. "Language". */
  label: string;
  /** Current selection printed on the control. */
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
 * Phone filter group. Every control prints its label and current value, so a
 * narrowed browse is legible without opening anything. Options open in a
 * thumb-reachable sheet instead of a drawer that pushes results down the page.
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

    // The list behind the sheet must not move under it: on a phone the app
    // shell is the scroll container, so the lock goes there rather than on
    // body, and the scroll position is restored on close.
    const shell = document.getElementById(APP_SCROLL_ROOT_ID);
    const locked = shell?.style.overflow ?? "";

    if (shell) {
      shell.style.overflow = "hidden";
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      if (shell) {
        shell.style.overflow = locked;
      }
    };
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
                  {selected ? (
                    <svg
                      className="dex-sheet-tick"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="m4.5 10.6 3.7 3.7 7.3-8" />
                    </svg>
                  ) : null}
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
          data-key={group.key}
          data-active={group.isDefault ? undefined : ""}
          disabled={group.disabled}
          aria-haspopup="dialog"
          aria-expanded={openKey === group.key}
          aria-label={`${group.label}: ${group.valueLabel}`}
          onClick={() => {
            setFilterText("");
            setOpenKey((current) => (current === group.key ? null : group.key));
          }}
        >
          <span className="dex-quick-chip-copy">
            <span className="dex-quick-chip-label">{group.label}</span>
            <span className="dex-quick-chip-value" title={group.valueLabel}>
              {group.valueLabel}
            </span>
          </span>
          <span className="dex-quick-chip-caret" aria-hidden />
        </button>
      ))}
      {scan ? <span className="dex-quick-scan">{scan}</span> : null}
      {mounted && sheet ? createPortal(sheet, document.body) : null}
    </div>
  );
}
