import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../auth/current-user';
import AuthScreen from '../../ui/AuthScreen';

export default async function AccountPage() {
  if (await getCurrentUser()) redirect('/');
  return <AuthScreen />;
}
