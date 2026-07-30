"use client";

import { useEffect, useId, useRef, useState } from "react";

type DesignVariant = "original" | "improved";

export function DesignComparisonDock({
  changes,
  surface,
}: {
  changes: readonly string[];
  surface: string;
}) {
  const [variant, setVariant] = useState<DesignVariant>("improved");
  const [changesOpen, setChangesOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const popoverId = useId();

  useEffect(() => {
    document.documentElement.dataset.designVariant = variant;
    document.documentElement.dataset.homeVariant = variant;
    window.dispatchEvent(new CustomEvent("pokedex-design-variant", { detail: variant }));

    return () => {
      delete document.documentElement.dataset.designVariant;
      delete document.documentElement.dataset.homeVariant;
    };
  }, [variant]);

  useEffect(() => {
    if (!changesOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setChangesOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChangesOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [changesOpen]);

  return (
    <aside ref={rootRef} className="home-compare" aria-label={`${surface} design comparison`}>
      {changesOpen ? (
        <div id={popoverId} className="home-compare-popover">
          <p className="home-compare-popover-title">What changed</p>
          <ol>
            {changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ol>
          <p className="home-compare-popover-note">
            Switch views below to compare this page in place.
          </p>
        </div>
      ) : null}

      <div className="home-compare-bar">
        <span className="home-compare-label" aria-hidden="true">
          Compare
        </span>
        <div className="home-compare-options" role="group" aria-label={`Choose ${surface} version`}>
          <button
            type="button"
            className="home-compare-option"
            aria-pressed={variant === "original"}
            onClick={() => setVariant("original")}
          >
            Original
          </button>
          <button
            type="button"
            className="home-compare-option"
            aria-pressed={variant === "improved"}
            onClick={() => setVariant("improved")}
          >
            Improved
          </button>
          <button
            type="button"
            className="home-compare-changes"
            aria-expanded={changesOpen}
            aria-controls={popoverId}
            onClick={() => setChangesOpen((open) => !open)}
          >
            Changes
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
