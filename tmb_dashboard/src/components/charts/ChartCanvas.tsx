import { useEffect, useRef } from 'react';
import {
  Chart,
  type ChartConfiguration,
  registerables,
} from 'chart.js';

Chart.register(...registerables);

interface ChartCanvasProps {
  config: ChartConfiguration;
  height?: number;
}

function cloneConfig(config: ChartConfiguration): ChartConfiguration {
  return {
    ...config,
    data: JSON.parse(JSON.stringify(config.data)),
    options: JSON.parse(JSON.stringify(config.options ?? {})),
  };
}

export function ChartCanvas({
  config,
  height = 280,
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const nextConfig = cloneConfig(config);
    chartRef.current?.destroy();
    chartRef.current = new Chart(context, nextConfig);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [config]);

  return (
    <div style={{ height }} className="relative">
      <canvas ref={canvasRef} />
    </div>
  );
}
