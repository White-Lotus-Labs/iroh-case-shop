'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Station } from '../shared/contracts';
import { createDockSpring } from './dockSpring';
import './StationDock.css';

type DockEntry = {
  id: Station;
  label: string;
  caption: string;
  seal: string;
  glyph: ReactNode;
};

const TRIM = '#dcb065';
const INK = '#3a2a1d';
const DARK = '#3f170d';
const GROUND = '#4a2c1a';

// Shared paints for every icon. Light falls from the top left.
const PAINTS = (
  <svg className="station-dock__paints" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="dock-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f5dc98" />
        <stop offset="1" stopColor="#a8792f" />
      </linearGradient>
      <linearGradient id="dock-lacquer" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7d2216" />
        <stop offset=".4" stopColor="#c8462d" />
        <stop offset="1" stopColor="#6a1b11" />
      </linearGradient>
      <linearGradient id="dock-cinnabar" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#dc6446" />
        <stop offset="1" stopColor="#8a2216" />
      </linearGradient>
      <linearGradient id="dock-jade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#a9d3b3" />
        <stop offset="1" stopColor="#3f6f55" />
      </linearGradient>
      <linearGradient id="dock-indigo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7384b8" />
        <stop offset="1" stopColor="#2c3765" />
      </linearGradient>
      <linearGradient id="dock-roof" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#557a6b" />
        <stop offset="1" stopColor="#1f332c" />
      </linearGradient>
      <linearGradient id="dock-wood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b07744" />
        <stop offset="1" stopColor="#5a321a" />
      </linearGradient>
      <linearGradient id="dock-wood-dark" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#74452a" />
        <stop offset="1" stopColor="#351d0e" />
      </linearGradient>
      <linearGradient id="dock-paper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fffaea" />
        <stop offset="1" stopColor="#e4d0a3" />
      </linearGradient>
      <linearGradient id="dock-stone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#dccbaa" />
        <stop offset="1" stopColor="#9a8763" />
      </linearGradient>
      <linearGradient id="dock-brocade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#4a6c63" />
        <stop offset="1" stopColor="#223933" />
      </linearGradient>
      <linearGradient id="dock-silver" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f0f2f3" />
        <stop offset="1" stopColor="#8a949a" />
      </linearGradient>
      <linearGradient id="dock-bronze" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e8c47e" />
        <stop offset=".5" stopColor="#a0712f" />
        <stop offset="1" stopColor="#5e3e18" />
      </linearGradient>
      <linearGradient id="dock-hair" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#c9c9c1" />
      </linearGradient>
      <linearGradient id="dock-robe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a06d3e" />
        <stop offset="1" stopColor="#4a2a16" />
      </linearGradient>
      <linearGradient id="dock-porcelain" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fdfaf2" />
        <stop offset="1" stopColor="#d3dbd7" />
      </linearGradient>
      <radialGradient id="dock-skin" cx=".4" cy=".35" r=".75">
        <stop offset="0" stopColor="#f6d3a8" />
        <stop offset=".6" stopColor="#dba47b" />
        <stop offset="1" stopColor="#b07a55" />
      </radialGradient>
      <radialGradient id="dock-clay" cx=".34" cy=".3" r=".8">
        <stop offset="0" stopColor="#b86c4e" />
        <stop offset=".55" stopColor="#7a3622" />
        <stop offset="1" stopColor={DARK} />
      </radialGradient>
      <radialGradient id="dock-sun" cx=".38" cy=".34" r=".7">
        <stop offset="0" stopColor="#fff4c6" />
        <stop offset=".5" stopColor="#f0b54a" />
        <stop offset="1" stopColor="#b8641e" />
      </radialGradient>
    </defs>
  </svg>
);

const DOCK: DockEntry[] = [
  {
    id: 'Entrance',
    label: 'Waiting room',
    caption: 'About the shop',
    seal: '茶',
    // Teahouse: jade tile roof, lacquered pillars, lit doorway, stone steps.
    glyph: (
      <>
        <ellipse
          cx="16"
          cy="29.8"
          rx="13"
          ry="1.3"
          fill={GROUND}
          opacity=".18"
        />
        <rect
          x="3.5"
          y="26.6"
          width="25"
          height="2.8"
          rx=".7"
          fill="url(#dock-stone)"
        />
        <rect
          x="5.5"
          y="24.6"
          width="21"
          height="2.4"
          rx=".6"
          fill="url(#dock-stone)"
        />
        <rect x="8" y="14.5" width="16" height="10.2" fill="url(#dock-paper)" />
        <path
          d="M10.2 16.6h3.4v6.2h-3.4zM18.4 16.6h3.4v6.2h-3.4zM11.9 16.6v6.2M10.2 19.7h3.4M20.1 16.6v6.2M18.4 19.7h3.4"
          fill="none"
          stroke="#8a5a36"
          strokeWidth=".5"
        />
        <path d="M14.3 24.6v-6a1.7 1.7 0 0 1 3.4 0v6z" fill="#3a200f" />
        <path
          d="M14.9 24.6v-5.7a1.1 1.1 0 0 1 2.2 0v5.7z"
          fill="#eaa84a"
          opacity=".8"
        />
        <rect
          x="6.6"
          y="13.4"
          width="2.2"
          height="11.4"
          fill="url(#dock-lacquer)"
        />
        <rect
          x="23.2"
          y="13.4"
          width="2.2"
          height="11.4"
          fill="url(#dock-lacquer)"
        />
        <rect x="5.6" y="12.6" width="20.8" height="2" fill="url(#dock-wood)" />
        <path d="M5.6 14.6h20.8" stroke={TRIM} strokeWidth=".5" />
        <path
          d="M8.6 6.8h14.8c1.6 3.2 4.1 5 7.8 4.2l-.6 1.4c-2.2.8-4.6 1.2-6.6 1H8c-2 .2-4.4-.2-6.6-1L.8 11c3.7.8 6.2-1 7.8-4.2z"
          fill="url(#dock-roof)"
        />
        <path
          d="M11.2 7.6v5.4M14 7.6v5.6M16.8 7.6v5.6M19.6 7.6v5.6M22.4 7.6v5.2M9 9.4v3.4"
          stroke="#0f1f19"
          strokeOpacity=".35"
          strokeWidth=".5"
        />
        <path
          d="M1.4 12.4c2.2.8 4.6 1.2 6.6 1h16c2 .2 4.4-.2 6.6-1"
          fill="none"
          stroke={TRIM}
          strokeWidth=".6"
        />
        <rect x="8" y="5.6" width="16" height="1.8" rx=".9" fill="#1a2b25" />
        <path
          d="M8.2 6.4c-1-.2-1.6-1-1.4-2M23.8 6.4c1-.2 1.6-1 1.4-2M16 5.6V3.6"
          fill="none"
          stroke={TRIM}
          strokeWidth=".9"
          strokeLinecap="round"
        />
        <circle cx="16" cy="2.9" r="1.1" fill="url(#dock-gold)" />
        <path d="M27.6 13.2v1.1" stroke="#3a200f" strokeWidth=".4" />
        <ellipse
          cx="27.6"
          cy="15.8"
          rx="1.3"
          ry="1.6"
          fill="url(#dock-cinnabar)"
        />
        <path d="M26.8 14.3h1.6M26.8 17.3h1.6" stroke={TRIM} strokeWidth=".5" />
      </>
    ),
  },
  {
    id: 'Counter',
    label: 'Counter',
    caption: 'Thesis Desk',
    seal: '论',
    // Ming desk with three large thesis cards fanned in a wooden stand.
    glyph: (
      <>
        <ellipse
          cx="16"
          cy="30.6"
          rx="13"
          ry="1.1"
          fill={GROUND}
          opacity=".18"
        />
        <path
          d="M5.2 26.8h1.8l-.3 2.8c0 .6-.4 1-1.1 1.1l.2-1.1zM26.8 26.8H25l.3 2.8c0 .6.4 1 1.1 1.1l-.2-1.1z"
          fill="url(#dock-wood-dark)"
        />
        <path d="M2.4 24.8h27.2v2H2.4z" fill="url(#dock-wood-dark)" />
        <path d="M3.4 25.8h25.2" stroke={TRIM} strokeWidth=".45" />
        <path d="M5.2 22.2h21.6l2.8 2.6H2.4z" fill="url(#dock-wood)" />
        <path
          d="M2.4 24.8c-.9-.2-1.4-1-1.2-2 .6.6 1.3.9 2.1.9zM29.6 24.8c.9-.2 1.4-1 1.2-2-.6.6-1.3.9-2.1.9z"
          fill="url(#dock-wood-dark)"
        />
        {(
          [
            ['url(#dock-jade)', -24, 'M13 10.4h.01'],
            ['url(#dock-indigo)', 24, 'M19 10.4h.01'],
          ] as const
        ).map(([fill, angle, pip]) => (
          <g key={angle} transform={`rotate(${angle} 16 22)`}>
            <rect
              x="11"
              y="7.4"
              width="10"
              height="14.6"
              rx="1.4"
              fill={fill}
              stroke={TRIM}
              strokeWidth=".6"
            />
            <rect
              x="12"
              y="8.4"
              width="8"
              height="12.6"
              rx=".8"
              fill="none"
              stroke="#f3d892"
              strokeWidth=".4"
              opacity=".8"
            />
            <path
              d={pip}
              stroke="#f3d892"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </g>
        ))}
        <rect
          x="11"
          y="6.6"
          width="10"
          height="14.8"
          rx="1.4"
          fill="url(#dock-cinnabar)"
          stroke={TRIM}
          strokeWidth=".6"
        />
        <g fill="none" stroke="#f3d892">
          <rect
            x="12"
            y="7.6"
            width="8"
            height="12.8"
            rx=".8"
            strokeWidth=".4"
            opacity=".8"
          />
          <circle cx="16" cy="12.8" r="2.6" strokeWidth=".6" />
          <path
            d="M13.2 17.4c.8-.8 1.8-.8 2.4 0 .6-.8 1.6-.8 2.4 0"
            strokeWidth=".5"
          />
        </g>
        <circle cx="16" cy="12.8" r="1" fill="#f3d892" />
        <rect
          x="9"
          y="20.4"
          width="14"
          height="3.8"
          rx=".8"
          fill="url(#dock-wood-dark)"
        />
        <path d="M9.6 20.9h12.8" stroke="#a87448" strokeWidth=".5" />
      </>
    ),
  },
  {
    id: 'AvatarSeat',
    label: 'Host',
    caption: 'Ask Uncle',
    seal: '谈',
    // Iroh behind a tea table: topknot, white beard, robe, teapot and cups.
    glyph: (
      <>
        <ellipse
          cx="16"
          cy="30.6"
          rx="12"
          ry="1.1"
          fill={GROUND}
          opacity=".2"
        />
        <path
          d="M3.6 27.6c0-6 5.4-9.6 12.4-9.6s12.4 3.6 12.4 9.6z"
          fill="url(#dock-robe)"
        />
        <path
          d="M12.2 18.8 16 24.6l3.8-5.8c-1.2-.5-2.4-.8-3.8-.8s-2.6.3-3.8.8z"
          fill="#e3cfa6"
        />
        <path
          d="m11.8 18.9 4.2 6.1 4.2-6.1"
          fill="none"
          stroke="#3a200f"
          strokeWidth=".6"
          opacity=".7"
        />
        <path
          d="M11.4 6.8c-2.4 1.2-3.2 4.4-2.4 7.6.3 1.2.9 2 1.6 2.6l1-8.6zM20.6 6.8c2.4 1.2 3.2 4.4 2.4 7.6-.3 1.2-.9 2-1.6 2.6l-1-8.6z"
          fill="url(#dock-hair)"
        />
        <ellipse cx="10.7" cy="11.8" rx="1" ry="1.5" fill="#d59c72" />
        <ellipse cx="21.3" cy="11.8" rx="1" ry="1.5" fill="#d59c72" />
        <ellipse cx="16" cy="11.2" rx="5.2" ry="5.8" fill="url(#dock-skin)" />
        <path
          d="M11.2 8.2c1-2.4 2.8-3.4 4.8-3.4s3.8 1 4.8 3.4c-1.4-1.2-3-1.7-4.8-1.7s-3.4.5-4.8 1.7z"
          fill="url(#dock-hair)"
        />
        <ellipse cx="16" cy="3.8" rx="2" ry="1.5" fill="url(#dock-hair)" />
        <rect x="15" y="4.8" width="2" height=".9" rx=".3" fill={TRIM} />
        <path
          d="M12.4 9.9c.9-.6 2-.7 2.8-.2M16.8 9.7c.8-.5 1.9-.4 2.8.2"
          fill="none"
          stroke="#fff"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <path
          d="M13 11.6c.5.5 1.3.5 1.8 0M17.2 11.6c.5.5 1.3.5 1.8 0"
          fill="none"
          stroke={INK}
          strokeWidth=".6"
          strokeLinecap="round"
        />
        <circle cx="12.9" cy="13.3" r=".9" fill="#e38a6a" opacity=".35" />
        <circle cx="19.1" cy="13.3" r=".9" fill="#e38a6a" opacity=".35" />
        <ellipse cx="16" cy="13" rx=".9" ry=".7" fill="#c98a60" />
        <path
          d="M11.8 15.4c.2 3.8 1.8 6.6 4.2 7.4 2.4-.8 4-3.6 4.2-7.4-1.2 1-2.6 1.6-4.2 1.6s-3-.6-4.2-1.6zM11.4 14.6c1.6.2 3.2-.4 4.6-.4s3 .6 4.6.4c-.6 1.4-2.2 1.9-4.6 1.4-2.4.5-4 0-4.6-1.4z"
          fill="url(#dock-hair)"
        />
        <path
          d="M14.4 18.4l.6 2.4M17.6 18.4l-.6 2.4"
          stroke="#b9b9b2"
          strokeWidth=".4"
        />
        <path d="M2.6 24.6h26.8l-1.2 1.8H3.8z" fill="url(#dock-wood)" />
        <path
          d="M3.8 26.4h24.4v1.2H3.8zM5 27.6h1.6v2.6H5zM25.4 27.6H27v2.6h-1.6z"
          fill="url(#dock-wood-dark)"
        />
        <path
          d="M5.2 22.6c-.9-.2-1.6-.8-2-1.8l-.7.3c.3 1.3 1.1 2.2 2.4 2.6z"
          fill="url(#dock-clay)"
        />
        <path
          d="M10.8 21.6c1.4-.3 2 .4 1.8 1.2-.2.7-.8 1-1.6 1"
          fill="none"
          stroke="#7a3622"
          strokeWidth=".8"
        />
        <path
          d="M5 23c0-1.8 1.4-2.6 3-2.6s3 .8 3 2.6c0 1.2-1.2 1.8-3 1.8s-3-.6-3-1.8z"
          fill="url(#dock-clay)"
        />
        <path
          d="M6.6 20.8c0-.7.6-1 1.4-1s1.4.3 1.4 1z"
          fill="url(#dock-clay)"
        />
        <circle cx="8" cy="19.5" r=".55" fill="url(#dock-clay)" />
        <path
          d="M20.4 22.6h3.4l-.5 2h-2.4zM24.6 22.6H28l-.5 2h-2.4z"
          fill="url(#dock-porcelain)"
        />
        <path d="M20.6 23.3h3M24.8 23.3h3" stroke="#4d6fa8" strokeWidth=".4" />
        <ellipse cx="22.1" cy="22.6" rx="1.7" ry=".35" fill="#b9853a" />
        <ellipse cx="26.3" cy="22.6" rx="1.7" ry=".35" fill="#b9853a" />
      </>
    ),
  },
  {
    id: 'Shelf',
    label: 'Shelf',
    caption: 'Top traders',
    seal: '榜',
    // Hanging scroll on a silk mount with gold, silver, and bronze ranks.
    glyph: (
      <>
        <ellipse cx="16" cy="30.2" rx="10" ry="1" fill={GROUND} opacity=".15" />
        <path
          d="M11.4 4.6 16 1.6l4.6 3"
          fill="none"
          stroke="#b08440"
          strokeWidth=".7"
          strokeLinejoin="round"
        />
        <rect
          x="8.6"
          y="5.6"
          width="14.8"
          height="20.6"
          fill="url(#dock-brocade)"
        />
        <rect
          x="10.4"
          y="7.6"
          width="11.2"
          height="16.4"
          fill="url(#dock-paper)"
        />
        <rect
          x="12.6"
          y="9"
          width="6.8"
          height="1.3"
          rx=".65"
          fill={INK}
          opacity=".75"
        />
        <circle cx="13" cy="13.4" r="1.25" fill="url(#dock-gold)" />
        <circle cx="13" cy="16.8" r="1.15" fill="url(#dock-silver)" />
        <circle cx="13" cy="20.2" r="1.1" fill="url(#dock-bronze)" />
        <g fill={INK} opacity=".6">
          <rect x="15" y="12.8" width="5" height="1.2" rx=".6" />
          <rect x="15" y="16.2" width="4.4" height="1.2" rx=".6" />
          <rect x="15" y="19.6" width="3.8" height="1.2" rx=".6" />
        </g>
        <rect
          x="18.8"
          y="21.6"
          width="1.8"
          height="1.8"
          rx=".3"
          fill="#b3321f"
        />
        <rect
          x="7.2"
          y="4.2"
          width="17.6"
          height="2"
          rx="1"
          fill="url(#dock-wood-dark)"
        />
        <rect
          x="5.8"
          y="3.9"
          width="1.8"
          height="2.6"
          rx=".6"
          fill="url(#dock-gold)"
        />
        <rect
          x="24.4"
          y="3.9"
          width="1.8"
          height="2.6"
          rx=".6"
          fill="url(#dock-gold)"
        />
        <rect
          x="6.6"
          y="25.8"
          width="18.8"
          height="2.8"
          rx="1.4"
          fill="url(#dock-wood)"
        />
        <rect
          x="4.6"
          y="25.4"
          width="2.4"
          height="3.6"
          rx=".8"
          fill="url(#dock-gold)"
        />
        <rect
          x="25"
          y="25.4"
          width="2.4"
          height="3.6"
          rx=".8"
          fill="url(#dock-gold)"
        />
      </>
    ),
  },
  {
    // The TeaTable station frames the orrery.
    id: 'TeaTable',
    label: 'Observatorium',
    caption: 'Wind the orrery',
    seal: '星',
    // Bronze orrery: meridian ring, tilted orbits, glowing sun, three planets.
    glyph: (
      <>
        <ellipse cx="16" cy="30" rx="8" ry="1.1" fill={GROUND} opacity=".2" />
        <path
          d="M9.6 28.6c0-1.4 2.8-2.2 6.4-2.2s6.4.8 6.4 2.2c0 .8-2.8 1.4-6.4 1.4s-6.4-.6-6.4-1.4z"
          fill="url(#dock-bronze)"
        />
        <path d="M15.1 21.8h1.8l.7 5h-3.2z" fill="url(#dock-bronze)" />
        <circle
          cx="16"
          cy="12.4"
          r="10"
          fill="none"
          stroke="url(#dock-bronze)"
          strokeWidth="1.3"
        />
        <g fill="none" stroke="#c99a52" transform="rotate(-14 16 12.4)">
          <ellipse cx="16" cy="12.4" rx="12.6" ry="4" strokeWidth=".8" />
          <ellipse cx="16" cy="12.4" rx="7.4" ry="2.4" strokeWidth=".7" />
        </g>
        <circle cx="16" cy="12.4" r="4.6" fill="#f3c25a" opacity=".25" />
        <circle cx="16" cy="12.4" r="2.9" fill="url(#dock-sun)" />
        <circle cx="4.8" cy="16.6" r="1.6" fill="url(#dock-jade)" />
        <circle cx="4.3" cy="16.1" r=".5" fill="#fff" opacity=".45" />
        <circle cx="26.1" cy="7.8" r="1.1" fill="url(#dock-indigo)" />
        <circle cx="19" cy="14" r="1.1" fill="url(#dock-cinnabar)" />
        <circle cx="16" cy="2.4" r=".9" fill="url(#dock-gold)" />
      </>
    ),
  },
];

export function DockPaints() {
  return PAINTS;
}

export function stationGlyph(label: string) {
  return DOCK.find((entry) => entry.label === label)?.glyph ?? null;
}

export function StationDock({
  station,
  reduced,
  onNavigate,
}: {
  station: Station;
  reduced: boolean;
  onNavigate: (station: Station) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const dock = useRef<ReturnType<typeof createDockSpring>>(null);
  useLayoutEffect(() => {
    const controller = createDockSpring(navRef.current!, reduced);
    dock.current = controller;
    return controller.destroy;
  }, [reduced]);
  useLayoutEffect(() => dock.current?.update(), [station]);
  const active = DOCK.find((entry) => entry.id === station);

  return (
    <nav ref={navRef} className="station-dock" aria-label="Tea room stations">
      <span className="station-dock__roller" aria-hidden="true" />
      <div className="station-dock__paper">
        {PAINTS}
        {DOCK.map((entry) => {
          const isActive = entry === active;
          return (
            <button
              key={entry.id}
              type="button"
              className="station-dock__item"
              data-dock-item
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onNavigate(entry.id)}
            >
              <span className="station-dock__glyph" aria-hidden="true">
                <svg viewBox="0 0 32 32">{entry.glyph}</svg>
                {isActive && (
                  <span className="station-dock__steam">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </span>
              <span className="station-dock__label">{entry.label}</span>
              <small className="station-dock__caption">{entry.caption}</small>
            </button>
          );
        })}
        {active && (
          <span
            className="station-dock__seal"
            data-dock-seal
            aria-hidden="true"
          >
            <i key={active.id}>{active.seal}</i>
          </span>
        )}
      </div>
      <span className="station-dock__roller" aria-hidden="true" />
    </nav>
  );
}
