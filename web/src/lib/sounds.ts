// Ring tones are synthesized with Web Audio, so there are no sound files to download.

export type Stopper = () => void;

let ctx: AudioContext | null = null;

/** Browsers only let audio start after a user gesture; call this from click handlers. */
export function unlockSounds() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* Web Audio unavailable */
  }
}

document.addEventListener('pointerdown', unlockSounds, { once: true });

function tone(freqs: number[], start: number, length: number, volume: number) {
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + length - 0.04);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(ctx.destination);
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + length);
  }
}

function loop(play: (t: number) => void, everyMs: number): Stopper {
  unlockSounds();
  let stopped = false;
  let timer = 0;
  const tick = () => {
    if (stopped || !ctx) return;
    play(ctx.currentTime + 0.05);
    timer = setTimeout(tick, everyMs);
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Incoming call: two short bright chirps. */
export const ringtone = () =>
  loop((t) => {
    tone([1046, 1318], t, 0.18, 0.12);
    tone([1046, 1318], t + 0.28, 0.18, 0.12);
  }, 1800);

/** Outgoing call: classic ringback, 2 s on, 4 s off. */
export const ringback = () => loop((t) => tone([440, 480], t, 2, 0.05), 6000);
