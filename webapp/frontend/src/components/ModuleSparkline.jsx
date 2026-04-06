import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

export default function ModuleSparkline({ id, data, trendColor }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity={0.4} />
            <stop offset="95%" stopColor={trendColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Tooltip
          cursor={{ stroke: "#334155", strokeOpacity: 0.3 }}
          contentStyle={{
            background: "#020617",
            border: "1px solid rgba(51, 65, 85, 0.75)",
            borderRadius: "0.75rem",
            color: "#cbd5e1",
            fontSize: 12,
          }}
          formatter={(value) => [`${value}`, "trend"]}
        />
        <Area type="monotone" dataKey="v" stroke={trendColor} strokeWidth={2} fill={`url(#grad-${id})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
