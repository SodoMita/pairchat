export type SoundType = "message" | "connected" | "disconnected";

type Tone = { frequency: number; at: number; duration: number };

const PATTERNS: Record<SoundType, Tone[]> = {
  message: [
    { frequency: 784, at: 0, duration: 0.08 },
    { frequency: 1046, at: 0.09, duration: 0.12 },
  ],
  connected: [
    { frequency: 523, at: 0, duration: 0.1 },
    { frequency: 659, at: 0.11, duration: 0.1 },
    { frequency: 784, at: 0.22, duration: 0.16 },
  ],
  disconnected: [
    { frequency: 494, at: 0, duration: 0.1 },
    { frequency: 370, at: 0.12, duration: 0.16 },
  ],
};

let context: AudioContext | null = null;
let unlockInstalled = false;

function audioContext() {
  if (typeof window === "undefined") return null;
  const Context =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (!context || context.state === "closed") context = new Context();
  return context;
}

export function areSoundsMuted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("luma-sounds-muted") === "true";
}

export function toggleSounds(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("luma-sounds-muted", String(muted));
}

export function unlockSounds() {
  const audio = audioContext();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();
  try {
    const buffer = audio.createBuffer(1, 1, 22050);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
  } catch {
    // A blocked context can still be resumed on the next gesture.
  }
}

export function installSoundUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => unlockSounds();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function playTone(audio: AudioContext, tone: Tone, volume: number) {
  const start = audio.currentTime + tone.at;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + tone.duration + 0.02);
}

export function playSound(type: SoundType) {
  if (areSoundsMuted()) return;
  const audio = audioContext();
  if (!audio) return;
  if (audio.state === "suspended") {
    void audio.resume().then(() => {
      if (audio.state === "running") playSound(type);
    });
    return;
  }
  try {
    for (const tone of PATTERNS[type]) playTone(audio, tone, type === "message" ? 0.08 : 0.07);
  } catch {
    // Audio can be unavailable in locked or headless browsers.
  }
}
