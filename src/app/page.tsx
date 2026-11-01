import TeaRoomShell from '../ui/TeaRoomShell';
import { getCurrentUser } from '../auth/current-user';
import { nansenAvailabilityFromEnv } from '../nansen/availability';

export default async function Page() {
  const user = await getCurrentUser();
  return (
    <TeaRoomShell
      key={user?.id ?? 'guest'}
      user={user}
      nansen={nansenAvailabilityFromEnv(process.env.NANSEN_API_KEY)}
    />
  );
}
