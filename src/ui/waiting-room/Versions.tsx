'use client';
import { memo } from 'react';
import { Sketchbook } from './Sketchbook';

// Sketchbook is the only waiting room.
// Memo: the shell re-renders as the room loads behind it; the book must not.
export const WaitingVersions = memo(function WaitingVersions({
  reduced,
}: {
  reduced: boolean;
}) {
  return <Sketchbook reduced={reduced} />;
});
