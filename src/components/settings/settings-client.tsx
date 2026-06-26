"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useCurrency } from "@/components/currency-provider";
import { SearchSelect } from "@/components/search/search-select";
import { CARD_LANGUAGE_FILTERS } from "@/lib/search-constants";
import {
  clearAllLocalAppData,
  clearBinderData,
  clearCurrencyPreference,
  clearFxRateCache,
  DEFAULT_APP_SETTINGS,
  exportPortfolioJson,
  importPortfolioJson,
  listLocalStorageKeys,
  readSettings,
  resetSettings,
  subscribeToAppStorage,
  subscribeToSettings,
  updateSettings,
  type AppSettings,
  type BinderGradingService,
  type BinderHoldingType,
  type ChartRange,
  type GradeFamilyFilter,
} from "@/lib/settings-store";
import { readPortfolio as readBinderItems, subscribeToPortfolio } from "@/lib/portfolio-store";
import type { CardLanguageFilter, SearchSortOption } from "@/types/pokemon";

const SORT_OPTIONS: Array<{ value: SearchSortOption; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "change-desc", label: "Price change: high to low" },
  { value: "change-asc", label: "Price change: low to high" },
  { value: "number-desc", label: "Card number: high to low" },
  { value: "number-asc", label: "Card number: low to high" },
];

const CHART_RANGE_OPTIONS: Array<{ value: ChartRange; label: string }> = [
  { value: "1m", label: "30 days" },
  { value: "3m", label: "90 days" },
  { value: "6m", label: "180 days" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "Maximum" },
];

const GRADE_FAMILY_OPTIONS: GradeFamilyFilter[] = [
  "All",
  "Ungraded",
  "PSA",
  "BGS",
  "CGC",
  "TAG",
  "SGC",
];

const BINDER_SERVICES: BinderGradingService[] = ["PSA", "BGS", "CGC", "SGC", "TAG"];

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not cached yet";
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

const SETTINGS_CARD_CLASS = "glass-card rounded-3xl p-5 sm:p-6";
const SETTINGS_INFO_BOX_CLASS = "info-box";
const SETTINGS_ACTION_ROW_CLASS = "flex flex-wrap gap-3";

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={SETTINGS_CARD_CLASS}>
      <div className="mb-4 space-y-2">
        <h2 className="font-[var(--font-game-copy)] text-xl font-semibold text-white">{title}</h2>
        <p className="text-sm leading-6 text-slate-400">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const fieldId = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="grid gap-2.5" role="group" aria-labelledby={fieldId}>
      <span
        id={fieldId}
        className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400"
      >
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs leading-5 text-slate-500">{hint}</span> : null}
    </div>
  );
}

export function SettingsClient() {
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement>(null);
  const { currency, ratesUpdatedAt } = useCurrency();
  const settings = useSyncExternalStore(subscribeToSettings, readSettings, () => DEFAULT_APP_SETTINGS);
  const [status, setStatus] = useState("");
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const binderCount = useSyncExternalStore(
    subscribeToPortfolio,
    () => readBinderItems().length,
    () => 0,
  );
  const storedKeysSignature = useSyncExternalStore(
    subscribeToAppStorage,
    () => listLocalStorageKeys().join("\0"),
    () => "",
  );
  const storedKeys = storedKeysSignature ? storedKeysSignature.split("\0") : [];

  const setStatusMessage = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(""), 4000);
  };

  const patchSettings = (patch: Partial<AppSettings>) => {
    updateSettings(patch);
    setStatusMessage("Settings saved");
  };

  const handleExportPortfolio = () => {
    const payload = exportPortfolioJson();
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pokepokedex-binder-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Binder backup downloaded");
  };

  const handleImportPortfolio = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      importPortfolioJson(text);
      setStatusMessage("Binder restored from backup");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  const handleClearAll = () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      setStatusMessage("Tap again to confirm clearing all local app data");
      return;
    }

    clearAllLocalAppData();
    setConfirmClearAll(false);
    setStatusMessage("All local app data cleared");
    router.refresh();
  };

  return (
    <div className="settings-stack grid gap-4 sm:gap-5">
      <SettingsSection
        title="Card Dex defaults"
        description="Applied when you open Card Dex without language or sort filters in the URL."
      >
        <SettingsField
          label="Default language"
          hint="Useful if you mostly collect Japanese, Korean, or another catalog."
        >
          <SearchSelect
            name="defaultSearchLanguage"
            ariaLabel="Default language"
            value={settings.defaultSearchLanguage}
            options={CARD_LANGUAGE_FILTERS.map((option) => ({
              value: option.code,
              label: option.label,
            }))}
            onChange={(value) =>
              patchSettings({
                defaultSearchLanguage: value as CardLanguageFilter,
              })
            }
          />
        </SettingsField>
        <SettingsField label="Default sort" hint="Controls how browse and search results are ordered.">
          <SearchSelect
            name="defaultSearchSort"
            ariaLabel="Default sort"
            value={settings.defaultSearchSort}
            options={SORT_OPTIONS}
            onChange={(value) =>
              patchSettings({
                defaultSearchSort: value as SearchSortOption,
              })
            }
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection
        title="Market & charts"
        description="Defaults for card detail charts and grade filters."
      >
        <SettingsField
          label="Default chart range"
          hint="Starting time window on card price charts. You can still change it per card."
        >
          <SearchSelect
            name="defaultChartRange"
            ariaLabel="Default chart range"
            value={settings.defaultChartRange}
            options={CHART_RANGE_OPTIONS}
            onChange={(value) =>
              patchSettings({
                defaultChartRange: value as ChartRange,
              })
            }
          />
        </SettingsField>
        <SettingsField
          label="Default grade family"
          hint="Which grader group is selected first on the market panel."
        >
          <SearchSelect
            name="defaultGradeFamily"
            ariaLabel="Default grade family"
            value={settings.defaultGradeFamily}
            options={GRADE_FAMILY_OPTIONS.map((option) => ({
              value: option,
              label: option,
            }))}
            onChange={(value) =>
              patchSettings({
                defaultGradeFamily: value as GradeFamilyFilter,
              })
            }
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection
        title="Binder defaults"
        description="Pre-select holding type and grading service when adding cards from a detail page."
      >
        <SettingsField label="Default holding">
          <SearchSelect
            name="binderHoldingType"
            ariaLabel="Default holding"
            value={settings.binderDefaults.holdingType}
            options={[
              { value: "Ungraded", label: "Ungraded (raw)" },
              { value: "Graded", label: "Graded (slab)" },
            ]}
            onChange={(value) =>
              patchSettings({
                binderDefaults: {
                  ...settings.binderDefaults,
                  holdingType: value as BinderHoldingType,
                },
              })
            }
          />
        </SettingsField>
        <SettingsField label="Default grading service">
          <SearchSelect
            name="binderGradingService"
            ariaLabel="Default grading service"
            value={settings.binderDefaults.gradingService}
            options={BINDER_SERVICES.map((service) => ({
              value: service,
              label: service,
            }))}
            onChange={(value) =>
              patchSettings({
                binderDefaults: {
                  ...settings.binderDefaults,
                  gradingService: value as BinderGradingService,
                },
              })
            }
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection
        title="Navigation"
        description="Control how the app behaves when you move between pages."
      >
        <label className={`${SETTINGS_INFO_BOX_CLASS} flex items-start gap-3`}>
          <input
            type="checkbox"
            checked={settings.scrollToTopOnNavigate}
            onChange={(event) =>
              patchSettings({
                scrollToTopOnNavigate: event.target.checked,
              })
            }
            className="mt-1 h-4 w-4 rounded"
          />
          <span className="grid gap-1">
            <span className="text-sm font-semibold text-white">Scroll to top on navigation</span>
            <span className="text-xs leading-5 text-slate-400">
              Jump to the top when changing routes or search filters. Turn off to keep your scroll
              position.
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsSection
        title="Display currency"
        description="Currency is stored locally in your browser. Exchange rates are cached for faster loading."
      >
        <div className={SETTINGS_INFO_BOX_CLASS}>
          <p>
            Current display currency: <strong>{currency}</strong>
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            FX cache updated: {formatTimestamp(ratesUpdatedAt)}
          </p>
        </div>
        <div className={SETTINGS_ACTION_ROW_CLASS}>
          <button
            type="button"
            onClick={() => {
              clearFxRateCache();
              setStatusMessage("Exchange rate cache cleared. Rates will refresh on next load.");
              router.refresh();
            }}
            className="btn btn-ghost btn-sm"
          >
            Clear FX cache
          </button>
          <button
            type="button"
            onClick={() => {
              clearCurrencyPreference();
              setStatusMessage("Currency reset to USD");
              router.refresh();
            }}
            className="btn btn-ghost btn-sm"
          >
            Reset currency to USD
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Binder data"
        description="Your binder lives in browser storage only. Export a backup before clearing data."
      >
        <div className={SETTINGS_INFO_BOX_CLASS}>
          <p>
            Tracked cards: <strong>{binderCount}</strong>
          </p>
        </div>
        <div className={SETTINGS_ACTION_ROW_CLASS}>
          <button
            type="button"
            onClick={handleExportPortfolio}
            className="btn btn-primary btn-sm"
          >
            Export binder JSON
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="btn btn-ghost btn-sm"
          >
            Import binder JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportPortfolio(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => {
              clearBinderData();
              setStatusMessage("Binder cleared");
            }}
            className="btn btn-destructive btn-sm"
          >
            Clear binder only
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Storage & reset"
        description="PokePokedex does not use cookies. All data below is stored in localStorage on this device."
      >
        <div className={SETTINGS_INFO_BOX_CLASS}>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
            Local keys ({storedKeys.length})
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
            {storedKeys.length ? (
              storedKeys.map((key) => <li key={key}>{key}</li>)
            ) : (
              <li>No PokePokedex data stored yet.</li>
            )}
          </ul>
        </div>
        <div className={SETTINGS_ACTION_ROW_CLASS}>
          <button
            type="button"
            onClick={() => {
              resetSettings();
              setConfirmClearAll(false);
              setStatusMessage("Settings reset to defaults");
            }}
            className="btn btn-ghost btn-sm"
          >
            Reset settings only
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className={`btn btn-destructive btn-sm ${confirmClearAll ? "btn-destructive--confirm" : ""}`}
          >
            {confirmClearAll ? "Confirm clear all data" : "Clear all local data"}
          </button>
        </div>
        <p className="text-xs leading-5 text-slate-500">
          Clear all removes binder, settings, currency preference, and cached exchange rates. This
          cannot be undone unless you exported your binder first.
        </p>
      </SettingsSection>

      {status ? (
        <p aria-live="polite" className="text-sm font-semibold text-emerald-300">
          {status}
        </p>
      ) : null}
    </div>
  );
}
