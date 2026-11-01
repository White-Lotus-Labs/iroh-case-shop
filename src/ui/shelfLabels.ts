import { shortenAddress } from '../leaderboard/model';

export function shelfLabel(
  displayName: string,
  address: string,
): string | null {
  const label = displayName.trim();
  if (!label || label.toLowerCase() === address.toLowerCase()) return null;
  if (label === shortenAddress(address)) return null;
  if (/^0x[\da-f]+(?:\.{3}[\da-f]+)?$/i.test(label)) return null;

  const referral = /^Uses\s+["'“]?(.+?)["'”]?\s+HL\s+Referral\s+Code\b/i.exec(
    label,
  );
  if (referral) return referral[1].trim().toLowerCase();
  if (/\breferral\b/i.test(label)) return null;
  if (/^HL\s+Perps\s+Whale\b/i.test(label)) return 'Whale';
  return label;
}
