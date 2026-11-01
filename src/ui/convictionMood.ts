import type { SceneMood } from '../scene/motion/dynamics';
import type { ConvictionLevel } from '../thesis/types';

export function convictionToMood(
  conviction: ConvictionLevel | null | undefined,
): SceneMood {
  switch (conviction) {
    case 'strong':
      return 'supported';
    case 'steeping':
      return 'mixed';
    case 'weak':
      return 'challenged';
    case 'unknown':
    case null:
    case undefined:
      return 'unknown';
    default: {
      const _exhaustive: never = conviction;
      return _exhaustive;
    }
  }
}
