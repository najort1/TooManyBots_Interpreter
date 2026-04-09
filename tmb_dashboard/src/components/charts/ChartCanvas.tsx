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

    if (!chartRef.current) {
      chartRef.current = new Chart(context, cloneConfig(config));
    }

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const nextConfig = cloneConfig(config);
    const nextType = (nextConfig as { type?: string }).type;
    if (nextType) {
      (chart.config as { type?: string }).type = nextType;
    }
    chart.data = nextConfig.data;
    chart.options = nextConfig.options ?? {};
    chart.update();
  }, [config]);

  return (
    <div style={{ height }} className="relative">
      <canvas ref={canvasRef} />
    </div>
  );
}
