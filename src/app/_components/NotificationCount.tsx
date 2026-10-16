"use client";

import { useEffect, useRef, useState } from "react";

const CHANNEL = "chatterbox:unread-count";

/**
 * Broadcasts and receives unread message counts across the whole app.
 * Place once in the root layout. When the count changes, updates
 * `document.title` with a badge like "(3) Chatterbox — …".
 *
 * Any chat page can post a count by calling:
 *   `window.dispatchEvent(new CustomEvent("chatterbox:unread-set", { detail: { count } }))`
 *
 * When the user focuses the window, the count resets to 0.
 */

const BASE_TITLE = "Chatterbox — Chat roulette & private rooms";

export function NotificationCount() {
  const countRef = useRef(0);

  useEffect(() => {
    const refreshTitle = (n: number) => {
      countRef.current = n;
      document.title =
        n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
    };

    // Listen for explicit count-set events from chat pages.
    const onSet = (e: Event) => {
      const count = (e as CustomEvent).detail?.count ?? 0;
      refreshTitle(count);
    };
    window.addEventListener("chatterbox:unread-set", onSet);

    // When the tab regains focus, clear the badge.
    const onFocus = () => refreshTitle(0);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("chatterbox:unread-set", onSet);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}