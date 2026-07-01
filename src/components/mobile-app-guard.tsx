"use client";

import { useEffect } from "react";

function blockGestureZoom(event: Event) {
  event.preventDefault();
}

export function MobileAppGuard() {
  useEffect(() => {
    if (!window.matchMedia("(max-width: 640px)").matches) {
      return;
    }

    const options: AddEventListenerOptions = { passive: false };

    document.addEventListener("gesturestart", blockGestureZoom, options);
    document.addEventListener("gesturechange", blockGestureZoom, options);
    document.addEventListener("gestureend", blockGestureZoom, options);

    return () => {
      document.removeEventListener("gesturestart", blockGestureZoom);
      document.removeEventListener("gesturechange", blockGestureZoom);
      document.removeEventListener("gestureend", blockGestureZoom);
    };
  }, []);

  return null;
}
