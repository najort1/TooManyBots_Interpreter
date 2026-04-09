import { useEffect, useMemo, useRef, useState } from 'react';
import { panelClass } from '../lib/uiTokens';

export type KpiColor = 'blue' | 'emerald' | 'slate' | 'red' | 'indigo' | 'amber' | 'purple';

interface KpiCardProps {
  title: string;
  value: number | string;
  icon: string;
  color?: KpiColor;
  formatValue?: (value: number) => string;
}

function useCountUp(target: number, durationMs = 420): number {
  const prefersReducedMotion = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false),
    []
  );

  const initialValue = Number.isFinite(target) ? target : 0;
  // If reduced motion is preferred, we don't start from 0 if there was no previous value
  // We initialize straight to the target value
  const [displayValue, setDisplayValue] = useState(prefersReducedMotion ? initialValue : 0);
  const previousValueRef = useRef(0);

  useEffect(() => {
    const startValue = previousValueRef.current;
    const endValue = Number.isFinite(target) ? target : 0;
    previousValueRef.current = endValue;

    if (prefersReducedMotion) {
      window.requestAnimationFrame(() => setDisplayValue(endValue));
      return;
    }

    const delta = endValue - startValue;
    if (Math.abs(delta) < 0.001) {
      window.requestAnimationFrame(() => setDisplayValue(endValue));
      return;
    }

    let rafId = 0;
    const startAt = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const progress = Math.min((now - startAt) / durationMs, 1);
      const nextValue = startValue + (delta * easeOut(progress));
      setDisplayValue(nextValue);
      if (progress < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [durationMs, prefersReducedMotion, target]);

  return displayValue;
}

export function KpiCard({ title, value, icon, color = 'blue', formatValue }: KpiCardProps) {
  const colorStyles = {
    blue: 'bg-[#edf4ff] text-[#3b82f6]',
    emerald: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-50 text-slate-500',
    red: 'bg-red-50 text-red-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  const selectedColorStyle = colorStyles[color] || colorStyles.blue;
  
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0);
  
  let renderedValue: string | number = value;

  if (typeof value === 'number') {
    renderedValue = formatValue
      ? formatValue(animatedValue)
      : `${Math.max(0, Math.round(animatedValue))}`;
  }

  return (
    <div className={[panelClass, 'flex items-center gap-4'].join(' ')}>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl ${selectedColorStyle}`}>
        <i className={icon} />
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#6f8298]">{title}</p>
        <p className="text-2xl font-extrabold text-[#112338] leading-none mt-1">{renderedValue}</p>
      </div>
    </div>
  );
}
