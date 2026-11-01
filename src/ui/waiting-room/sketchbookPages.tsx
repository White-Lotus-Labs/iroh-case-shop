import { createContext, useContext, type ReactNode } from 'react';
import { DockPaints, stationGlyph } from '../StationDock';
import { PROJECT, REPO_URL, TEAM, xUrl, type Member } from './content';
import { LotusMark } from './LotusMark';

export type SketchPage = {
  key: string;
  render: (live: boolean) => ReactNode;
};

const Folio = ({ n }: { n: number }) => (
  <span className="sb-folio" aria-hidden="true">
    {n}
  </span>
);

function sketchSources(src: string) {
  if (src.endsWith('sketch-shop-front.webp')) {
    return {
      src,
      srcSet:
        '/images/waiting-room/sketch-shop-front-640w.webp 640w, /images/waiting-room/sketch-shop-front.webp 960w',
      sizes: '(max-width: 720px) 320px, 40vw',
    };
  }
  if (src.includes('/waiting-room/team-')) {
    return {
      src,
      srcSet: `${src.replace('.webp', '-480w.webp')} 480w, ${src} 768w`,
      sizes: '(max-width: 720px) 240px, 280px',
    };
  }
  return { src, srcSet: undefined, sizes: undefined };
}

/** The same candidate `srcset` would pick, so a page-shot bake is not a second download. */
export function sketchPreloadUrl(src: string) {
  if (typeof window === 'undefined') return src;
  const small = window.matchMedia('(max-width: 720px)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const team = src.includes('/waiting-room/team-');
  const css = team
    ? small
      ? 240
      : 280
    : small
      ? 320
      : window.innerWidth * 0.4;
  const need = css * dpr;
  if (src.endsWith('sketch-shop-front.webp'))
    return need <= 640 ? src.replace('.webp', '-640w.webp') : src;
  if (team) return need <= 480 ? src.replace('.webp', '-480w.webp') : src;
  return src;
}

/** True inside the sketchbook's hidden baker, whose page copies are never shown. */
export const BakerCopy = createContext(false);

function Sketch({
  src,
  alt,
  live,
  className = '',
  priority = false,
}: {
  src: string;
  alt: string;
  live: boolean;
  className?: string;
  priority?: boolean;
}) {
  const baking = useContext(BakerCopy);
  const image = sketchSources(src);
  return (
    <img
      className={`sb-sketch ${className}`}
      src={image.src}
      srcSet={image.srcSet}
      sizes={image.sizes}
      alt={live ? alt : ''}
      draggable={false}
      // A page turn swaps the leaf's snapshot for this page in one frame; a
      // lazy or async image paints blank for a frame there. Only the hidden
      // baker copies stay lazy, so they never download twice.
      decoding={baking ? 'async' : 'sync'}
      loading={priority || !baking ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

const PORTRAIT_ALT: Record<string, string> = {
  '0x_iroh':
    'Ink sketch of 0x_iroh as a smiling old tea farmer with a cup of tea and a tablet chart.',
  '0x_Takezo':
    'Ink sketch of 0x_Takezo as a young ronin holding a camera and a microphone.',
  david_grii:
    'Ink sketch of david_grii with a laptop, holding an anime mask beside his unimpressed face.',
  PandaCoderexe:
    'Ink sketch of PandaCoderexe in a panda hoodie, typing on a laptop beside a ring light.',
  tldde:
    'Ink sketch of tldde, very tall, at a brass telescope with a cat on his shoulder.',
};

// Margin notes in the sketcher's hand: label position, then the point the
// arrow lands on, both as percentages of the square portrait.
type Note = { text: string; x: number; y: number; to: [number, number] };
const NOTES: Record<string, Note[]> = {
  '0x_iroh': [
    { text: 'farmer’s hat', x: 2, y: 6, to: [26, 20] },
    { text: 'a chart, always', x: 74, y: 30, to: [72, 41] },
  ],
  '0x_Takezo': [
    { text: 'always filming', x: 0, y: 8, to: [21, 22] },
    { text: 'meme charms', x: 70, y: 84, to: [61, 86] },
  ],
  david_grii: [
    { text: 'not an anime fan', x: 0, y: 8, to: [29, 24] },
    { text: 'the real face', x: 70, y: 6, to: [58, 22] },
  ],
  PandaCoderexe: [
    { text: 'the studio', x: 0, y: 14, to: [18, 30] },
    { text: 'no coffee', x: 90, y: 60, to: [83, 79] },
  ],
  tldde: [
    { text: 'the Observatorium', x: -2, y: 2, to: [18, 25] },
    { text: 'the cat', x: 82, y: 6, to: [72, 22] },
  ],
};

function Annotations({ notes }: { notes: Note[] }) {
  return (
    <span className="sb-notes" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {notes.map(({ text, x, y, to: [tx, ty] }) => {
          // Leave from the label edge nearest the target, then bow a little.
          const sx = tx > x + 12 ? x + 14 : x + 4;
          const sy = ty > y ? y + 4 : y - 1;
          const cx = (sx + tx) / 2 + (ty - sy) * 0.25;
          const cy = (sy + ty) / 2 - (tx - sx) * 0.25;
          const ang = Math.atan2(ty - cy, tx - cx);
          const head = (d: number) =>
            `${tx - 2.6 * Math.cos(ang + d)},${ty - 2.6 * Math.sin(ang + d)}`;
          return (
            <g key={text}>
              <path d={`M${sx},${sy} Q${cx},${cy} ${tx},${ty}`} />
              <path d={`M${head(0.5)} L${tx},${ty} L${head(-0.5)}`} />
            </g>
          );
        })}
      </svg>
      {notes.map(({ text, x, y }) => (
        <span key={text} style={{ left: `${x}%`, top: `${y}%` }}>
          {text}
        </span>
      ))}
    </span>
  );
}

function memberPage(member: Member, n: number, folio: number): SketchPage {
  return {
    key: member.handle,
    render: (live) => (
      <div className="sb-page-inner sb-member">
        <span className="sb-figure">
          <Sketch
            src={member.portrait}
            alt={PORTRAIT_ALT[member.handle]}
            live={live}
            className="sb-portrait"
          />
          <Annotations notes={NOTES[member.handle]} />
        </span>
        <p className="sb-kicker">
          No. {n} of {TEAM.length}
        </p>
        <h2 className="sb-handle">{member.handle}</h2>
        <p className="sb-roles">{member.roles}</p>
        <p className="sb-note">{member.bio}</p>
        <a
          className="sb-link sb-link-x"
          href={xUrl(member.handle)}
          target="_blank"
          rel="noreferrer"
          tabIndex={live ? undefined : -1}
        >
          @{member.handle} on X <span aria-hidden="true">↗</span>
        </a>
        <Folio n={folio} />
      </div>
    ),
  };
}

const SHOP_SKETCH = '/images/waiting-room/sketch-shop-front.webp';
const ROOM_SKETCH = '/images/waiting-room/sketch-tea-room.webp';

export const SKETCH_PAGES: SketchPage[] = [
  {
    key: 'cover',
    render: (live) => (
      <div className="sb-page-inner sb-cover-art">
        <Sketch
          src={SHOP_SKETCH}
          alt="Ink and watercolour sketch of the tea shop front at dusk, doors open under a cherry tree."
          live={live}
          priority={live}
        />
        <p className="sb-caption-hand">
          The shop at dusk. The doors stay open.
        </p>
        <Folio n={1} />
      </div>
    ),
  },
  {
    key: 'title',
    render: () => (
      <div className="sb-page-inner sb-title">
        <span className="sb-mark" aria-hidden="true">
          <LotusMark variant="sketch" />
        </span>
        <p className="sb-kicker">
          {PROJECT.studio} · Nansen Meridian Buildathon
        </p>
        <h1 className="sb-name">{PROJECT.name}</h1>
        <p className="sb-tagline">{PROJECT.tagline}</p>
        <span className="sb-rule" aria-hidden="true" />
        <p className="sb-body">{PROJECT.summary}</p>
        <div className="sb-sign">
          <p className="sb-fine">{PROJECT.honesty}</p>
          <span className="sb-seal" aria-hidden="true">
            白蓮
          </span>
        </div>
        <p className="sb-turn-hint" aria-hidden="true">
          turn the page →
        </p>
        <Folio n={2} />
      </div>
    ),
  },
  {
    key: 'room',
    render: (live) => (
      <div className="sb-page-inner sb-room">
        <Sketch
          src={ROOM_SKETCH}
          alt="Ink sketch of the tea room: the counter and lantern, a low tea table with a teapot, and Uncle, the host, seated beside the shelf with a cup, his straw hat on the floor."
          live={live}
          className="sb-room-art"
        />
        <p className="sb-kicker">Inside</p>
        <h2 className="sb-heading">Four stops, one pot of tea.</h2>
        <p className="sb-body">
          Move through the room at your own pace. The counter and the shelf read
          Nansen numbers the shop saved. Uncle asks Nansen when you talk to him.
          The orrery is just brass to wind.
        </p>
        <Folio n={3} />
      </div>
    ),
  },
  {
    key: 'stations',
    render: () => (
      <div className="sb-page-inner sb-stations">
        <DockPaints />
        <p className="sb-kicker">How the room works</p>
        <ol>
          {PROJECT.steps.map((step) => (
            <li key={step.label}>
              <span className="sb-step-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32">{stationGlyph(step.label)}</svg>
              </span>
              <div>
                <h3>
                  {step.label} <small>{step.caption}</small>
                </h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="sb-caption-hand">
          Explore as a guest. Create an account only if you want Uncle to
          remember your conversations.
        </p>
        <Folio n={4} />
      </div>
    ),
  },
  {
    key: 'team',
    render: (live) => (
      <div className="sb-page-inner sb-hello">
        <p className="sb-kicker">The team</p>
        <h2 className="sb-heading">Made by five friends of the White Lotus.</h2>
        <ul>
          {TEAM.map((member) => (
            <li key={member.handle}>
              <a
                href={xUrl(member.handle)}
                target="_blank"
                rel="noreferrer"
                tabIndex={live ? undefined : -1}
              >
                @{member.handle}
              </a>
              <span>{member.roles.split(' · ')[0]}</span>
            </li>
          ))}
        </ul>
        <Folio n={5} />
      </div>
    ),
  },
  {
    key: 'team-close',
    render: (live) => (
      <div className="sb-page-inner sb-hello">
        <p className="sb-kicker">White Lotus Labs</p>
        <h2 className="sb-heading">
          Five friends built one unusual research room.
        </h2>
        <p className="sb-body">
          Product, story, 3D interface, onchain data, APIs, and systems—turned
          into a place you can walk through.
        </p>
        <a
          className="sb-link"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          tabIndex={live ? undefined : -1}
        >
          Explore the code on GitHub <span aria-hidden="true">↗</span>
        </a>
        <div className="sb-sign">
          <p className="sb-caption-hand">
            The lanterns are lit. Choose a thesis and step inside.
          </p>
          <span className="sb-seal" aria-hidden="true">
            白蓮
          </span>
        </div>
        <Folio n={6} />
      </div>
    ),
  },
  ...TEAM.map((member, i) => memberPage(member, i + 1, i + 7)),
  {
    key: 'end',
    render: () => (
      <div className="sb-page-inner sb-hello sb-end">
        <p className="sb-kicker">End of the book</p>
        <h2 className="sb-heading">Choose a thesis. Follow the smart money.</h2>
        <div className="sb-sign">
          <span className="sb-seal" aria-hidden="true">
            白蓮
          </span>
        </div>
        <Folio n={12} />
      </div>
    ),
  },
];

export const SPREAD_TITLES = [
  'The Tea Shop',
  'The Room',
  'The Team',
  '0x_iroh · 0x_Takezo',
  'david_grii · PandaCoderexe',
  'tldde',
];
