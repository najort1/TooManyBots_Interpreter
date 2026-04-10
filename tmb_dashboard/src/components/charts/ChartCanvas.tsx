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

function getConfigSignature(config: ChartConfiguration): string {
  return JSON.stringify({
    type: config.type,
    data: config.data,
    options: config.options ?? {},
  });
}

export function ChartCanvas({
  config,
  height = 280,
}: ChartCanvasProps) {
  const initialConfigRef = useRef(config);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const previousConfigSignatureRef = useRef('');
  const hasAnimatedFirstDataUpdateRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    if (!chartRef.current) {
      const initialConfig = initialConfigRef.current;
      chartRef.current = new Chart(context, cloneConfig(initialConfig));
      previousConfigSignatureRef.current = getConfigSignature(initialConfig);
    }

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const nextConfigSignature = getConfigSignature(config);
    if (nextConfigSignature === previousConfigSignatureRef.current) return;

    const nextConfig = cloneConfig(config);
    const nextType = (nextConfig as { type?: string }).type;
    if (nextType) {
      (chart.config as { type?: string }).type = nextType;
    }
    chart.data = nextConfig.data;
    chart.options = nextConfig.options ?? {};

    if (!hasAnimatedFirstDataUpdateRef.current) {
      chart.update();
      hasAnimatedFirstDataUpdateRef.current = true;
    } else {
      chart.update('none');
    }

    previousConfigSignatureRef.current = nextConfigSignature;
  }, [config]);

  return (
    <div style={{ height }} className="relative">
      <canvas ref={canvasRef} />
    </div>
  );
}
