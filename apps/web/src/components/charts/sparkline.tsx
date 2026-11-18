import { useTranslation } from 'react-i18next';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';

export interface SparkPoint {
  /** The month or week, in words. */
  label: string;
  /** Null where there is nothing to show (a rate with nothing to divide by). */
  value: number | null;
  /** The value in words, exact. */
  display: string;
}

/** Twelve points, no axes, no labels; hover shows the month and the value (feature 19, D4). */
export function Sparkline({ points, color }: { points: readonly SparkPoint[]; color: string }) {
  const { i18n } = useTranslation();
  const data = (i18n.dir() === 'rtl' ? [...points].reverse() : points).map((point, index) => ({
    ...point,
    index,
  }));
  if (points.filter((point) => point.value !== null).length < 2) return null;
  const content = ({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) => {
    const point = payload[0]?.payload as SparkPoint | undefined;
    if (!active || !point) return null;
    return (
      <div className="rounded-md bg-ink px-2 py-1 text-[11.5px] whitespace-nowrap text-white">
        {point.label} · <span dir="ltr">{point.display}</span>
      </div>
    );
  };
  return (
    <div dir="ltr" aria-hidden className="h-7 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Tooltip content={content} cursor={false} isAnimationActive={false} />
          <Line
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 2.5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
