"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Plays a short audio beep and/or shows a browser notification when a
 * message arrives from another user while the tab is not visible.
 *
 * Listens for `chatterbox:incoming-message` CustomEvents dispatched by
 * the ChatWindow whenever a non-system message from another user
 * arrives while `document.hidden` is true.
 *
 * The audio uses WebAudio's `OscillatorNode` so no sound file is
 * needed. It's a soft, non-intrusive double-tap chime (~0.3s).
 *
 * Browser notifications are only shown after the user grants
 * permission. They auto-close after 4 seconds and click-to-focus.
 */

export function NotificationSound() {
  const lastPlayRef = useRef(0);
  // Track throttling for browser notifications separately (longer gap).
  const lastNotificationRef = useRef(0);

  // Play a soft two-tone chime via WebAudio.
  const playChime = useCallback(() => {
    // Throttle to max once per 10 seconds — chime floods are spammy.
    const now = Date.now();
    if (now - lastPlayRef.current < 10000) return;
    lastPlayRef.current = now;

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!ctx) return;

      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + start + dur,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };

      // Two soft tones, 120ms apart.
      tone(660, 0, 0.15);
      tone(880, 0.12, 0.18);

      // Close the context after the sound finishes.
      setTimeout(() => ctx.close().catch(() => {}), 500);
    } catch {
      // WebAudio not available.
    }
  }, []);

  // Show a browser notification (if permission granted).
  // Throttled to once per 20 seconds — notifications are more
  // attention-demanding than chimes.
  const showNotification = useCallback((title: string, body: string) => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    const now = Date.now();
    if (now - lastNotificationRef.current < 20_000) return;
    lastNotificationRef.current = now;
    try {
      const n = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: "chatterbox-message",
        silent: true, // We play our own chime.
      });
      // Auto-close after 4 seconds.
      setTimeout(() => n.close(), 4000);
      // Click to focus this tab.
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Notification API blocked or denied.
    }
  }, []);

  useEffect(() => {
    const onMessage = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        senderName?: string;
        body?: string;
      };
      playChime();
      if (Notification.permission === "granted") {
        showNotification(
          d.senderName || "New message",
          d.body?.slice(0, 100) || "You received a new message.",
        );
      }
    };
    window.addEventListener("chatterbox:incoming-message", onMessage);
    return () =>
      window.removeEventListener("chatterbox:incoming-message", onMessage);
  }, [playChime, showNotification]);

  return null;
}