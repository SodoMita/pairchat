// Simple notification sounds using Web Audio API
// This creates a pleasant notification tone programmatically

export type SoundType = "message" | "connected" | "disconnected";

const soundContexts: Map<SoundType, AudioContext | null> = new Map();

function createOscillator(
  context: AudioContext,
  type: OscillatorType = "sine",
  frequency: number = 800,
  duration: number = 0.1,
): OscillatorNode {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    0.001,
    context.currentTime + duration,
  );
  return oscillator;
}

export function playSound(type: SoundType): void {
  // Check if sounds are muted (user preference)
  if (typeof window !== "undefined") {
    const muted = window.localStorage.getItem("luma-sounds-muted");
    if (muted === "true") return;
  }

  try {
    // Use a single context for each sound type to avoid creating too many contexts
    let context = soundContexts.get(type);
    
    if (!context || context.state === "closed") {
      context = new (window.AudioContext || (window as any).webkitAudioContext)();
      soundContexts.set(type, context);
    }

    if (!context) return;

    // Configuration for different sound types
    const configs: Record<SoundType, { frequencies: number[]; duration: number }> = {
      message: {
        frequencies: [800, 1000, 1200],
        duration: 0.15,
      },
      connected: {
        frequencies: [600, 900],
        duration: 0.2,
      },
      disconnected: {
        frequencies: [400, 200],
        duration: 0.2,
      },
    };

    const config = configs[type];
    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(0.1, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, context.currentTime + config.duration);

    // Create a chord for richer sound
    const oscillators = config.frequencies.map((freq) => {
      const oscillator = createOscillator(
        context,
        "sine",
        freq,
        config.duration,
      );
      oscillator.connect(gainNode);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + config.duration);
      return oscillator;
    });

    gainNode.connect(context.destination);

    // Clean up after sound finishes
    setTimeout(() => {
      oscillators.forEach((osc) => {
        try {
          osc.disconnect();
        } catch {
          // Already disconnected
        }
      });
      try {
        gainNode.disconnect();
      } catch {
        // Already disconnected
      }
    }, config.duration * 1000 + 100);
  } catch {
    // Audio not supported or blocked
    // Fallback: try HTML5 Audio with data URI
    try {
      const audio = new Audio(
        "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAESsAAABkYXRhAAABAAgGAAB4bnMAAAAAAABQVZFZm10IBAAAAABAAEAESsAAABkYXRhAAABAAgGAAB4bnMAAAAAAABQVZFZm10IBAAAAABAAEAESsA",
      );
      audio.volume = 0.1;
      audio.play().catch(() => {});
    } catch {
      // Audio completely unavailable
    }
  }
}

export function toggleSounds(muted: boolean): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("luma-sounds-muted", String(muted));
  }
}

export function areSoundsMuted(): boolean {
  if (typeof window !== "undefined") {
    return window.localStorage.getItem("luma-sounds-muted") === "true";
  }
  return false;
}
