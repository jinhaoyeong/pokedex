export const APP_SCROLL_ROOT_ID = "app-scroll-root";

export function isMobileAppShell() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 640px)").matches
  );
}

export function getAppScrollRoot() {
  if (typeof window === "undefined") {
    return null;
  }

  return document.getElementById(APP_SCROLL_ROOT_ID);
}

export function scrollAppToTop() {
  if (typeof window === "undefined") {
    return;
  }

  const scrollRoot = getAppScrollRoot();

  if (isMobileAppShell() && scrollRoot) {
    scrollRoot.scrollTo({ top: 0, left: 0, behavior: "instant" });
    return;
  }

  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}
