export type Member = {
  handle: string;
  roles: string;
  bio: string;
  portrait: string;
};

const art = (name: string) => `/images/waiting-room/${name}.webp`;

export const TEAM: Member[] = [
  {
    handle: '0x_iroh',
    roles: 'Product vision · visual direction · UI',
    bio: 'Wise uncle, trader, investor, vibecoder, farmer.',
    portrait: art('team-iroh'),
  },
  {
    handle: '0x_Takezo',
    roles: 'Story · video · marketing',
    bio: 'NFT and meme connoisseur, and an upcoming marketing star. Builds study\u2011for\u2011A and runs YouTube channels.',
    portrait: art('team-takezo'),
  },
  {
    handle: 'david_grii',
    roles: 'Front-end · 3D UI',
    bio: 'Full-stack dev across SaaS, health, and crypto. Does not watch anime, yet somehow has an anime pfp.',
    portrait: art('team-david'),
  },
  {
    handle: 'PandaCoderexe',
    roles: 'Back-end · API · UI',
    bio: 'A high schooler with three years of programming behind him. High agency. Runs his own YouTube channel.',
    portrait: art('team-panda'),
  },
  {
    handle: 'tldde',
    roles: 'Systems · onchain data · Observatorium',
    bio: 'Tall, seasoned dev. On-chain analytics and systems engineering. Has a cat.',
    portrait: art('team-tldde'),
  },
];

export const xUrl = (handle: string) => `https://x.com/${handle}`;
export const REPO_URL = 'https://github.com/White-Lotus-Labs/iroh-tea-shop';

export const PROJECT = {
  name: "Iroh's Tea Shop",
  studio: 'White Lotus Labs',
  tagline: 'Choose a crypto thesis. See whether smart money supports it.',
  summary:
    'Walk through a 3D tea shop built on Nansen data. Open a thesis, read its conviction signal, check the wallets and positions behind each asset, and ask Uncle what it means.',
  // Same names and captions as the station dock inside.
  steps: [
    {
      label: 'Counter',
      caption: 'Thesis Desk',
      text: 'Choose one of three theses. Read its conviction signal, then open the four assets behind it.',
    },
    {
      label: 'Host',
      caption: 'Ask Uncle',
      text: 'Ask about a token, a wallet, or an onchain trend. Uncle asks Nansen’s Research Agent and brings back the answer.',
    },
    {
      label: 'Shelf',
      caption: 'Top traders',
      text: 'Four 30-day boards from Nansen: perps traders, smart wallets, whales and meme traders. Open any wallet in Nansen’s profiler.',
    },
    {
      label: 'Observatorium',
      caption: 'Wind the orrery',
      text: 'Wind the brass orrery and watch the planets turn. This stop shows no market data.',
    },
  ],
  honesty:
    'The team wrote the three theses. Conviction, asset evidence, and the trader list are Nansen readings saved in the shop and refreshed hourly, or every 4 hours for the slow ones. Uncle still asks Nansen when you talk to him.',
};
