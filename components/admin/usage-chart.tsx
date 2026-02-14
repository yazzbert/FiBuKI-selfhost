"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AIUsageDailyStats } from "@/types/ai-usage";
import { FunctionCallDailyStats } from "@/types/function-call";

interface UsageChartProps {
  data: AIUsageDailyStats[] | FunctionCallDailyStats[];
  type: "line" | "bar";
  dataKey: "calls" | "cost" | "inputTokens" | "outputTokens" | "errorCount" | "successCount";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatValue(value: number, dataKey: string): string {
  if (dataKey === "cost") {
    return `$${value.toFixed(4)}`;
  }
  if (dataKey === "inputTokens" || dataKey === "outputTokens") {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  }
  return value.toString();
}

const CHART_COLORS: Record<string, string> = {
  calls: "var(--color-chart-1)",
  cost: "var(--color-chart-2)",
  inputTokens: "var(--color-chart-3)",
  outputTokens: "var(--color-chart-4)",
  errorCount: "var(--color-chart-5)",
  successCount: "var(--color-chart-2)",
};

export function UsageChart({ data, type, dataKey }: UsageChartProps) {
  const color = CHART_COLORS[dataKey] || "var(--color-chart-1)";

  const formattedData = data.map((item) => ({
    ...item,
    label: formatDate(item.date),
  }));

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border rounded-md p-2 shadow-md">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">
            {formatValue(payload[0].value, dataKey)}
          </p>
        </div>
      );
    }
    return null;
  };

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={formattedData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickFormatter={(value) => formatValue(value, dataKey)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={formattedData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          tickFormatter={(value) => formatValue(value, dataKey)}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={{ fill: color, strokeWidth: 2 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
