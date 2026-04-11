import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function HotspotChart({ incidents }) {
  const { villageData, typeData } = useMemo(() => {
    // Process data for Bar Chart (Villages)
    const vCounts = incidents.reduce((acc, i) => {
      const v = i.reporterVillage || 'Unknown';
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});

    const vData = Object.entries(vCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 villages

    // Process data for Pie Chart (Types)
    const tCounts = incidents.reduce((acc, i) => {
      const t = i.type.replace('_', ' ');
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

    const tData = Object.entries(tCounts).map(([name, value]) => ({ name, value }));

    return { villageData: vData, typeData: tData };
  }, [incidents]);

  const COLORS = ['#2d7a3a', '#ea580c', '#ca8a04', '#dc2626', '#8b5e3c'];

  if (incidents.length === 0) return <p className="text-neutral-500 text-sm">No data available for the selected period.</p>;

  return (
    <div className="space-y-8">
      <div className="h-48">
        <h4 className="text-xs font-semibold text-neutral-500 mb-2 uppercase">Incidents by Village (Top 5)</h4>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={villageData}>
            <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} angle={-45} textAnchor="end" height={60} />
            <YAxis allowDecimals={false} width={30} />
            <Tooltip />
            <Bar dataKey="count" fill="#2d7a3a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="h-48">
        <h4 className="text-xs font-semibold text-neutral-500 mb-2 uppercase">Distribution by Type</h4>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={typeData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              dataKey="value"
            >
              {typeData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
