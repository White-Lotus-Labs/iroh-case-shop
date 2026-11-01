export type NansenAvailability = 'configured' | 'unavailable';

export function nansenAvailabilityFromEnv(
  value: string | undefined,
): NansenAvailability {
  return value?.trim() ? 'configured' : 'unavailable';
}

export function isNansenAvailability(
  value: unknown,
): value is NansenAvailability {
  return value === 'configured' || value === 'unavailable';
}
