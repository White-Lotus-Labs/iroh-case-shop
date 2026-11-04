import type { Metadata } from 'next';
import { Cases } from '../../case/Cases';
import './cases.css';

export const metadata: Metadata = {
  title: "Dragon Tea Case | Iroh's Case Shop",
  description:
    'A NEAR Testnet case opening demonstration. USDI is a test currency with no real monetary value.',
};
export default function CasesPage() {
  return <Cases />;
}
