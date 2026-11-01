// The White Lotus seal: eight hearts, points in, clefts out, and a ring of
// dots. `solid` is the printed mark. `sketch` is the same mark drawn in ink.

const INK = '#1A3C5F';
const PAPER = '#F3EDE1';

const HEART =
  'M0 -16.4C-6.6 -21.5 -14.4 -31.2 -13.8 -37.2C-13.2 -41.6 -7.4 -40.8 -3.6 -38.2C-1.7 -36.8 -0.55 -35.6 0 -34.8C0.55 -35.6 1.7 -36.8 3.6 -38.2C7.4 -40.8 13.2 -41.6 13.8 -37.2C14.4 -31.2 6.6 -21.5 0 -16.4Z';

function wobble(d: string, seed: number) {
  let n = 0;
  return d.replace(/-?\d*\.?\d+/g, (raw) => {
    n += 1;
    const j = Math.sin(seed * 2.3 + n * 1.7) * 0.55;
    return (parseFloat(raw) + j).toFixed(2);
  });
}

export function LotusMark({
  variant = 'solid',
}: {
  variant?: 'solid' | 'sketch';
}) {
  const sketch = variant === 'sketch';
  const petal = sketch ? 'none' : PAPER;
  const line = sketch ? 'currentColor' : 'none';
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true">
      {sketch ? null : <circle r="49.2" fill={INK} />}
      {Array.from({ length: 8 }, (_, i) => (
        <path
          key={i}
          d={sketch ? wobble(HEART, i + 1) : HEART}
          fill={petal}
          stroke={line}
          strokeWidth={sketch ? 0.8 : 0}
          strokeLinejoin="round"
          transform={`rotate(${i * 45})`}
        />
      ))}
      <g
        fill={sketch ? 'none' : PAPER}
        stroke={sketch ? 'currentColor' : 'none'}
        strokeWidth={sketch ? 0.7 : 0}
      >
        <circle r="3.05" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <circle
              key={i}
              cx={Math.cos(a) * 8.05}
              cy={Math.sin(a) * 8.05}
              r="2.62"
            />
          );
        })}
      </g>
      {sketch ? (
        <>
          <ellipse
            rx="43.3"
            ry="42.7"
            transform="rotate(-8)"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
          />
          <ellipse
            rx="47.6"
            ry="47.1"
            transform="rotate(5)"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.15"
          />
        </>
      ) : (
        <>
          <circle r="43.45" fill="none" stroke={PAPER} strokeWidth="1.25" />
          <circle r="47.35" fill="none" stroke={PAPER} strokeWidth="2.15" />
        </>
      )}
    </svg>
  );
}
