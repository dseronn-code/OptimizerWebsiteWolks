import { Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Abertura animada da ITCOMTECH: o símbolo se constrói (traços + pontos), as letras entram uma a uma
 * e o nome do sistema aparece, com som sintetizado em sincronia (Web Audio, sem arquivo de áudio).
 *
 * Navegadores só liberam som depois de um toque/clique. Por isso o áudio é "destravado" no clique de
 * "Entrar" (primeIntroAudio) e a abertura toca com som logo depois do login.
 * Toca uma vez por sessão do navegador; sair do sistema (resetIntro) faz tocar de novo na próxima entrada. Ao abrir o site já logado,
 * a animação toca e o som sai apenas se o navegador permitir.
 */

const SHOWN_KEY = 'itc-intro-shown';
const MUTE_KEY = 'itc-intro-muted';
const DURATION_MS = 3400;

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    return ctx;
  } catch {
    return null;
  }
}

/** Chame dentro de um clique (ex.: botão "Entrar") para o navegador liberar o som. */
export function primeIntroAudio() {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume().catch(() => undefined);
}

/** Ao sair, a próxima entrada mostra a abertura de novo. */
export function resetIntro() {
  try {
    sessionStorage.removeItem(SHOWN_KEY);
  } catch {
    /* ignora */
  }
}

function muted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Trilha sonora da abertura, alinhada com a animação (tempos em segundos). */
function playSound() {
  const a = audio();
  if (!a || a.state !== 'running' || muted()) return;
  const t0 = a.currentTime + 0.05;
  const master = a.createGain();
  master.gain.value = 0.32;
  const comp = a.createDynamicsCompressor();
  master.connect(comp).connect(a.destination);

  // 1) "whoosh" de entrada: ruído filtrado subindo (0 → 0,9 s)
  const len = Math.floor(a.sampleRate * 1.1);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(300, t0);
  bp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.9);
  const ng = a.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.5, t0 + 0.55);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.05);
  noise.connect(bp).connect(ng).connect(master);
  noise.start(t0);
  noise.stop(t0 + 1.1);

  const tone = (freq: number, at: number, dur: number, vol: number, type: OscillatorType = 'sine') => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0 + at);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(master);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.05);
  };

  // 2) um "blip" para cada ponto do símbolo (mesmos tempos do CSS)
  [
    [523.25, 0.55],
    [659.25, 0.7],
    [783.99, 0.85],
    [987.77, 1.0],
  ].forEach(([f, at]) => {
    tone(f, at, 0.28, 0.35);
    tone(f * 2, at, 0.12, 0.08, 'triangle');
  });

  // 3) "tiques" suaves das letras (1,15 → 1,75 s)
  for (let i = 0; i < 9; i++) tone(1800 + i * 60, 1.15 + i * 0.07, 0.05, 0.05, 'triangle');

  // 4) acorde final quando aparece "Estoque Inteligente" (1,9 s), com grave de impacto
  const sub = a.createOscillator();
  const sg = a.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, t0 + 1.9);
  sub.frequency.exponentialRampToValueAtTime(55, t0 + 2.5);
  sg.gain.setValueAtTime(0.0001, t0 + 1.9);
  sg.gain.exponentialRampToValueAtTime(0.6, t0 + 1.93);
  sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.7);
  sub.connect(sg).connect(master);
  sub.start(t0 + 1.9);
  sub.stop(t0 + 2.8);
  [261.63, 329.63, 392.0, 493.88, 587.33].forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = i % 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    o.detune.value = (i - 2) * 4;
    g.gain.setValueAtTime(0.0001, t0 + 1.9);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.3);
    o.connect(g).connect(master);
    o.start(t0 + 1.9);
    o.stop(t0 + 3.4);
  });
}

export default function Intro({ autoStart }: { autoStart: boolean }) {
  const [run, setRun] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [isMuted, setIsMuted] = useState(muted());
  const timers = useRef<number[]>([]);

  const close = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setLeaving(true);
    timers.current.push(window.setTimeout(() => { setRun(0); setLeaving(false); }, 450));
  }, []);

  const start = useCallback(() => {
    try {
      sessionStorage.setItem(SHOWN_KEY, '1');
    } catch {
      /* ignora */
    }
    timers.current.forEach(clearTimeout);
    setLeaving(false);
    setRun((n) => n + 1);
    playSound();
    timers.current = [window.setTimeout(close, DURATION_MS)];
  }, [close]);

  // abertura ao entrar no sistema: logo após o login ou ao abrir o site já logado (uma vez por sessão do navegador)
  useEffect(() => {
    if (!autoStart) return;
    let shown = false;
    try {
      shown = sessionStorage.getItem(SHOWN_KEY) === '1';
    } catch {
      /* ignora */
    }
    if (!shown) start();
  }, [autoStart, start]);

  useEffect(() => {
    if (!run) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [run, close]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!run) return null;

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !isMuted;
    setIsMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      /* ignora */
    }
    if (next && ctx) void ctx.suspend().catch(() => undefined);
    if (!next && ctx) void ctx.resume().catch(() => undefined);
  };

  return (
    <div
      key={run}
      className={`itc-intro fixed inset-0 z-[100] flex cursor-pointer items-center justify-center overflow-hidden bg-brand-950 ${leaving ? 'itc-leave' : ''}`}
      onClick={close}
      role="dialog"
      aria-label="ITCOMTECH Estoque Inteligente"
    >
      <div className="itc-glow pointer-events-none absolute h-[38rem] w-[38rem] rounded-full bg-brand-500/30 blur-3xl" aria-hidden />
      <div className="itc-grid pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative flex flex-col items-center px-6">
        <div className="relative flex items-end">
          <div className="flex select-none items-end text-[13vw] leading-none text-white sm:text-[5.5rem]">
            {'IT'.split('').map((ch, i) => (
              <span key={`b${i}`} className="itc-letter font-extrabold" style={{ animationDelay: `${1150 + i * 70}ms` }}>{ch}</span>
            ))}
            {'COMTECH'.split('').map((ch, i) => (
              <span key={`l${i}`} className="itc-letter font-light" style={{ animationDelay: `${1290 + i * 70}ms` }}>{ch}</span>
            ))}
          </div>
          {/* símbolo: traços se desenham e os pontos surgem um a um */}
          <svg viewBox="0 0 100 100" className="itc-mark absolute -right-[11%] -top-[78%] h-[100%] w-auto overflow-visible sm:-right-14 sm:-top-[4.25rem] sm:h-[6.5rem]" aria-hidden>
            <defs>
              <linearGradient id="itc-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#5fb2ff" />
                <stop offset="1" stopColor="#2b5fb0" />
              </linearGradient>
              <filter id="itc-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
            </defs>
            <g stroke="url(#itc-g)" strokeLinecap="round" strokeWidth="13" fill="none">
              {['M50 50 L50 27', 'M50 50 L28 50', 'M50 50 L74 47', 'M50 50 L53 74'].map((d, i) => (
                <path key={d} d={d} pathLength={1} className="itc-stroke" style={{ animationDelay: `${150 + i * 90}ms` }} />
              ))}
            </g>
            <g fill="url(#itc-g)">
              {[[50, 22, 10, 550], [24, 51, 11, 700], [78, 47, 12, 850], [53, 78, 10, 1000]].map(([cx, cy, r, d]) => (
                <g key={`${cx}-${cy}`} className="itc-dot" style={{ animationDelay: `${d}ms`, transformOrigin: `${cx}px ${cy}px` }}>
                  <circle cx={cx} cy={cy} r={r + 6} fill="#5fb2ff" opacity="0.45" filter="url(#itc-blur)" />
                  <circle cx={cx} cy={cy} r={r} />
                </g>
              ))}
            </g>
          </svg>
        </div>

        <div className="itc-shine mt-1 h-px w-full max-w-[22rem] bg-gradient-to-r from-transparent via-accent-500 to-transparent sm:max-w-[30rem]" aria-hidden />
        <div className="itc-tagline mt-4 text-center text-xs font-semibold uppercase text-brand-100 sm:text-sm">Estoque Inteligente</div>
      </div>

      <button
        className="absolute bottom-6 right-6 rounded-full bg-white/10 p-2.5 text-brand-100 ring-1 ring-white/15 transition hover:bg-white/20"
        onClick={toggleMute}
        aria-label={isMuted ? 'Ativar som da abertura' : 'Desativar som da abertura'}
        title={isMuted ? 'Ativar som da abertura' : 'Desativar som da abertura'}
      >
        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <span className="itc-skip absolute bottom-7 left-1/2 -translate-x-1/2 text-[11px] text-brand-300/70">toque para pular</span>
    </div>
  );
}
