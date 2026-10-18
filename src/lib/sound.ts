/**
 * Tiny, dependency-free notification sounds synthesised with the Web Audio API.
 *
 * Browsers only allow audio after a user gesture, so the context is created
 * lazily and resumed on the first pointer/key interaction (see
 * `installSoundUnlock`). No audio files are downloaded and no third-party
 * scripts are involved, keeping the strict CSP intact.
 */
export type SoundName = "sent" | "received" | "matched" | "left" | "error" | "toggle";

export const SOUND_PREFERENCE_KEY = "luma-sound-enabled-v1";

type BrowserAudioContext = AudioContext & { resume: () => Promise<void> };

let audioContext: BrowserAudioContext | null = null;
let preference: boolean | null = null;
let unlockInstalled = false;

function readPreference(): boolean {
  if (preference !== null) return preference;
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(SOUND_PREFERENCE_KEY);
    preference = stored === null ? true : stored === "on";
  } catch {
    preference = true;
  }
  return preference;
}

export function isSoundEnabled(): boolean {
  return readPreference();
}

export function setSoundEnabled(next: boolean) {
  preference = next;
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, next ? "on" : "off");
  } catch {
    // Private browsing modes may refuse writes; the in-memory value still works.
  }
  if (next) void unlockAudio();
}

function getContext(): BrowserAudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    if (!audioContext) audioContext = new AudioContextCtor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
  return audioContext;
}

/** Resume the audio context from inside a real user gesture. */
export async function unlockAudio(): Promise<boolean> {
  const context = getContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

/**
 * Called once from the client app. Install on both pointer and key gestures so
 * the first interaction anywhere unlocks later message sounds.
 */
export function installSoundUnlock() {
  if (typeof window === "undefined" || unlockInstalled) return () => {};
  unlockInstalled = true;
  const unlock = () => {
    void unlockAudio();
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  window.addEventListener("touchstart", unlock, { passive: true });
  return () => {
    unlockInstalled = false;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
  };
}

type Note = {
  frequency: number;
  /** Offset from the start of the pattern, in seconds. */
  at: number;
  duration: number;
  volume: number;
  type: OscillatorType;
};

const patterns: Record<SoundName, Note[]> = {
  sent: [
    { frequency: 740, at: 0, duration: 0.08, volume: 0.045, type: "triangle" },
    { frequency: 988, at: 0.055, duration: 0.09, volume: 0.035, type: "triangle" },
  ],
  received: [
    { frequency: 587, at: 0, duration: 0.12, volume: 0.05, type: "sine" },
    { frequency: 784, at: 0.1, duration: 0.16, volume: 0.045, type: "sine" },
  ],
  matched: [
    { frequency: 523, at: 0, duration: 0.13, volume: 0.05, type: "sine" },
    { frequency: 659, at: 0.1, duration: 0.13, volume: 0.05, type: "sine" },
    { frequency: 784, at: 0.2, duration: 0.22, volume: 0.05, type: "sine" },
  ],
  left: [
    { frequency: 392, at: 0, duration: 0.15, volume: 0.045, type: "sine" },
    { frequency: 294, at: 0.13, duration: 0.2, volume: 0.04, type: "sine" },
  ],
  error: [
    { frequency: 233, at: 0, duration: 0.1, volume: 0.05, type: "square" },
    { frequency: 196, at: 0.11, duration: 0.16, volume: 0.04, type: "square" },
  ],
  toggle: [
    { frequency: 880, at: 0, duration: 0.09, volume: 0.04, type: "sine" },
    { frequency: 1175, at: 0.07, duration: 0.11, volume: 0.035, type: "sine" },
  ],
};

/**
 * Play a short notification pattern. Returns true when the browser accepted it,
 * so callers can surface a hint instead of silently failing.
 */
export function playSound(name: SoundName): boolean {
  if (!isSoundEnabled()) return false;
  const context = getContext();
  if (!context || context.state !== "running") return false;

  const start = context.currentTime + 0.01;
  for (const note of patterns[name]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, start + note.at);
    gain.gain.setValueAtTime(0.0001, start + note.at);
    gain.gain.exponentialRampToValueAtTime(note.volume, start + note.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + note.at);
    oscillator.stop(start + note.at + note.duration + 0.03);
  }

  if (name === "received" || name === "matched") {
    try {
      navigator.vibrate?.(name === "matched" ? [24, 40, 24] : 18);
    } catch {
      // Haptics are best-effort and unsupported on most desktops.
    }
  }
  return true;
}
