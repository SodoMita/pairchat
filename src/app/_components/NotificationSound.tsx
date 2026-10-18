"use client";
import { useEffect, useRef } from "react";

/** Opt-in, throttled alerts. Never send decrypted text/names to OS banners. */
export function NotificationSound() {
  const audio = useRef<AudioContext | null>(null);
  const lastSound = useRef(0);
  const lastBanner = useRef(0);
  useEffect(() => {
    const unlock = () => {
      try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* unsupported */ }
    };
    const notify = () => {
      if (!document.hidden) return;
      try {
        const now = Date.now();
        if (localStorage.getItem("chatterbox.sound") === "on" && audio.current?.state === "running" && now - lastSound.current > 10_000) {
          lastSound.current = now;
          const ctx = audio.current;
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.frequency.value = 660; gain.gain.setValueAtTime(0.06, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
          osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.2);
          osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        }
        if (localStorage.getItem("chatterbox.notifications") === "on" && typeof Notification !== "undefined" && Notification.permission === "granted" && now - lastBanner.current > 20_000) {
          lastBanner.current = now;
          const alert = new Notification("Chatterbox", { body: "You have a new encrypted message.", tag: "chatterbox-message", silent: true });
          alert.onclick = () => { window.focus(); alert.close(); };
          setTimeout(() => alert.close(), 4000);
        }
      } catch { /* denied APIs/storage must never break chat */ }
    };
    window.addEventListener("chatterbox:enable-sound", unlock);
    window.addEventListener("chatterbox:incoming-message", notify);
    return () => {
      window.removeEventListener("chatterbox:enable-sound", unlock);
      window.removeEventListener("chatterbox:incoming-message", notify);
      void audio.current?.close().catch(() => {}); audio.current = null;
    };
  }, []);
  return null;
}
