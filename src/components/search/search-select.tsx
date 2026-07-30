"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

type SearchSelectOption = {
  label: string;
  value: string;
};

function subscribeClientMounted() {
  return () => {};
}

function getClientMounted() {
  return true;
}

function isEventInsideSelect(
  target: EventTarget | null,
  root: HTMLDivElement | null,
  menu: HTMLDivElement | null,
) {
  if (!(target instanceof Node)) {
    return false;
  }

  return Boolean(root?.contains(target) || menu?.contains(target));
}

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
  const [activeIndex, setActiveIndex] = useState(0);
  const fallbackLabelId = useId();
  const labelId = labelledBy ?? fallbackLabelId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ignoreOutsideUntilRef = useRef(0);
  const mounted = useSyncExternalStore(subscribeClientMounted, getClientMounted, () => false);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0] ?? { label: "Select", value: "" };

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;

    if (!trigger || !menu) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, openUpward ? spaceAbove - 10 : spaceBelow - 10);

    menu.style.position = "fixed";
    menu.style.left = `${left}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(120, maxHeight)}px`;
    menu.style.zIndex = "280";
    menu.style.visibility = "visible";

    if (openUpward) {
      menu.style.top = `${rect.top - 8}px`;
      menu.style.transform = "translateY(-100%)";
    } else {
      menu.style.top = `${rect.bottom + 8}px`;
      menu.style.transform = "";
    }
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);

    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [isOpen, options.length, positionMenu, selectedOption.label]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.focus();
    });

    function closeOnOutsidePointer(event: PointerEvent) {
      if (performance.now() < ignoreOutsideUntilRef.current) {
        return;
      }

      if (!isEventInsideSelect(event.target, rootRef.current, menuRef.current)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    const listenerFrame = window.requestAnimationFrame(() => {
      document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    });
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.cancelAnimationFrame(listenerFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeIndex, isOpen]);

  const openMenu = (preferredIndex?: number) => {
    ignoreOutsideUntilRef.current = performance.now() + 320;
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selectedOption.value),
    );
    const nextIndex = preferredIndex ?? selectedIndex;
    setActiveIndex(Math.min(Math.max(nextIndex, 0), Math.max(options.length - 1, 0)));
    setIsOpen(true);
  };

  const toggleMenu = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    openMenu();
  };

  const chooseOption = (index: number) => {
    const option = options[index];
    if (!option) {
      return;
    }

    setActiveIndex(index);
    setIsOpen(false);
    onChange?.(option.value);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const menu =
    isOpen && mounted ? (
      <div
        ref={menuRef}
        className="select-menu select-menu-portal"
        role="listbox"
        aria-label={ariaLabel ?? name}
        style={{ visibility: "hidden" }}
        onKeyDown={(event) => {
          if (!options.length) {
            return;
          }

          let nextIndex = activeIndex;
          if (event.key === "ArrowDown") {
            nextIndex = (activeIndex + 1) % options.length;
          } else if (event.key === "ArrowUp") {
            nextIndex = (activeIndex - 1 + options.length) % options.length;
          } else if (event.key === "Home") {
            nextIndex = 0;
          } else if (event.key === "End") {
            nextIndex = options.length - 1;
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            chooseOption(activeIndex);
            return;
          } else if (event.key === "Tab") {
            setIsOpen(false);
            return;
          } else {
            return;
          }

          event.preventDefault();
          setActiveIndex(nextIndex);
          optionRefs.current[nextIndex]?.focus();
        }}
      >
        {options.map((option, index) => {
          const isSelected = option.value === selectedOption.value;

          return (
            <button
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              key={`${name}-${option.value || "all"}-${index}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                chooseOption(index);
              }}
              className={`select-option ${isSelected ? "select-option-active" : ""}`}
            >
              <span>{option.label}</span>
              {isSelected ? <span className="select-option-dot" /> : null}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div ref={rootRef} className="search-select relative min-w-0" data-open={isOpen ? "true" : "false"}>
      <input type="hidden" name={name} value={selectedOption.value} />
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy ? undefined : labelId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const selectedIndex = Math.max(
              0,
              options.findIndex((option) => option.value === selectedOption.value),
            );
            const nextIndex =
              event.key === "ArrowDown"
                ? Math.min(selectedIndex + 1, options.length - 1)
                : Math.max(selectedIndex - 1, 0);
            openMenu(nextIndex);
          }
        }}
        className="select-trigger"
      >
        <span id={labelledBy ? undefined : labelId} className="select-trigger-label">
          {selectedOption.label}
        </span>
        <span className="select-chevron" aria-hidden="true" />
      </button>

      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
