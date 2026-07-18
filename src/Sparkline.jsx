import { meanGrade } from './matrixdata';

export default function Sparkline({ points }) {
  if (points.length < 2) return <p className="muted">Not enough history yet.</p>;
  const w = 240, h = 48, pad = 6;
  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / (points.length - 1));
  const ys = points.map(p => pad + (1 - (4 - p.mean) / 3) * (h - 2 * pad)); // 1=best(top) .. 4=worst(bottom)
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x},${ys[i]}`).join(' ');
  return (
    <svg width={w} height={h}>
      <path d={d} fill="none" stroke="var(--g2)" strokeWidth="2" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="3" fill={`var(--g${meanGrade(points[i].mean)})`} />)}
    </svg>
  );
}
