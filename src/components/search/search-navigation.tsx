"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SearchNavigationContextValue = {
  isSearchPending: boolean;
  beginSearchNavigation: () => void;
};

const SearchNavigationContext = createContext<SearchNavigationContextValue>({
  isSearchPending: false,
  beginSearchNavigation: () => {},
});

export function SearchNavigationProvider({
  navigationKey,
  children,
}: {
  navigationKey: string;
  children: ReactNode;
}) {
  const [isSearchPending, setIsSearchPending] = useState(false);

  useEffect(() => {
    setIsSearchPending(false);
  }, [navigationKey]);

  const beginSearchNavigation = useCallback(() => {
    setIsSearchPending(true);
  }, []);

  const value = useMemo(
    () => ({
      isSearchPending,
      beginSearchNavigation,
    }),
    [beginSearchNavigation, isSearchPending],
  );

  return (
    <SearchNavigationContext.Provider value={value}>
      {children}
    </SearchNavigationContext.Provider>
  );
}

export function useSearchNavigation() {
  return useContext(SearchNavigationContext);
}

export function SearchResultsPendingGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const { isSearchPending } = useSearchNavigation();
  return isSearchPending ? fallback : children;
}
