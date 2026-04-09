import { useEffect, useState } from 'react';
import mascotImage from '../../assets/QA7VK-removebg-preview.png';

interface EmptyStateMascotProps {
  title: string;
  description?: string;
  compact?: boolean;
  className?: string;
}

export function EmptyStateMascot({
  title,
  description,
  compact = false,
  className = '',
}: EmptyStateMascotProps) {
  const [mascotSrc, setMascotSrc] = useState(mascotImage);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.src = mascotImage;

    image.onload = () => {
      if (cancelled) return;

      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      if (!canvas.width || !canvas.height) {
        setMascotSrc(mascotImage);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setMascotSrc(mascotImage);
        return;
      }

      ctx.drawImage(image, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = frame.data;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        if (a === 0) continue;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const isLowSaturation = max - min <= 20;
        const isMidGray = r >= 96 && r <= 166 && g >= 96 && g <= 166 && b >= 96 && b <= 166;

        if (isLowSaturation && isMidGray) {
          pixels[i + 3] = 0;
        }
      }

      ctx.putImageData(frame, 0, 0);
      setMascotSrc(canvas.toDataURL('image/png'));
    };

    image.onerror = () => {
      if (!cancelled) setMascotSrc(mascotImage);
    };

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-4' : 'py-6',
        className,
      ].join(' ')}
    >
      <img
        src={mascotSrc}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className={[
          'pointer-events-none select-none object-contain drop-shadow-[0_8px_18px_rgba(18,32,51,0.14)]',
          compact ? 'h-32 w-32' : 'h-36 w-36',
        ].join(' ')}
      />
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      {description ? <p className="mt-1 max-w-[34ch] text-xs text-slate-500">{description}</p> : null}
    </div>
  );
}
