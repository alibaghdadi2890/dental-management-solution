/**
 * The alert chimes (spec §Alerts), made with Web Audio: no sound file to ship. Browsers start an
 * `AudioContext` suspended until someone interacts with the page; `unlockSound` resumes it on the
 * first click or key press, and `soundBlocked` says whether it is still waiting for one.
 */
let context: AudioContext | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

function audio(): AudioContext | null {
  if (context) return context;
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  context = new window.AudioContext();
  context.addEventListener('statechange', notify);
  return context;
}

/** Whether a chime would be silent until the page is clicked. */
export function soundBlocked(): boolean {
  const ctx = audio();
  return ctx !== null && ctx.state !== 'running';
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resumes the audio on the first gesture on the page, and again should the browser suspend it. */
export function unlockSound(): () => void {
  const resume = () => {
    const ctx = audio();
    if (ctx && ctx.state !== 'running') void ctx.resume().then(notify, notify);
  };
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown', resume, true);
  return () => {
    window.removeEventListener('pointerdown', resume, true);
    window.removeEventListener('keydown', resume, true);
  };
}

function tone(ctx: AudioContext, frequency: number, at: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.22, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + 0.65);
}

/** One soft tone for an arrival, two rising for a visit started. Silent while blocked. */
export function chime(kind: 'arrived' | 'started'): void {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (kind === 'arrived') {
    tone(ctx, 784, now);
  } else {
    tone(ctx, 659, now);
    tone(ctx, 988, now + 0.18);
  }
}
