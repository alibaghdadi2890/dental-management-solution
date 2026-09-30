import type { Visit } from '@dcm/contracts';
import { useEffect, useState } from 'react';

/** The visit fields the timer reads. */
export type VisitClock = Pick<
  Visit,
  'status' | 'startedAt' | 'pausedAt' | 'pausedSeconds' | 'completedAt' | 'serverNow'
>;

const TICK_MS = 1000;

/**
 * Seconds of work on the visit at `nowMs` (server time), the API's `elapsedSeconds` rule
 * (`clinical/domain/visit-timer.ts`, W19): from `startedAt` to where the clock stopped
 * (`completedAt`, else `pausedAt`, else now), less the paused time; whole seconds, never negative.
 */
export function visitElapsedSeconds(
  visit: Omit<VisitClock, 'status' | 'serverNow'>,
  nowMs: number,
): number {
  const stoppedAt = visit.completedAt ?? visit.pausedAt;
  const endMs = stoppedAt === null ? nowMs : Date.parse(stoppedAt);
  const whole = Math.max(0, Math.floor((endMs - Date.parse(visit.startedAt)) / 1000));
  return Math.max(0, whole - visit.pausedSeconds);
}

const two = (n: number) => String(n).padStart(2, '0');

/** `mm:ss`, switching to `hh:mm:ss` from an hour (the POC's timer chip). */
export function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = `${two(minutes)}:${two(seconds % 60)}`;
  return hours > 0 ? `${two(hours)}:${rest}` : rest;
}

/**
 * The visit's running timer text, rendered from the server's clock rather than the browser's:
 * `offset = serverNow − receivedAt`, where `receivedAt` is when that data arrived (the query's
 * `dataUpdatedAt`). It ticks every second only while `in_progress`; paused or completed, it shows
 * the frozen value. Never earlier than `serverNow`, so a resume doesn't jump back before the
 * first tick. Empty until there is a visit.
 */
export function useVisitTimer(visit: VisitClock | undefined, receivedAt: number): string {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const running = visit?.status === 'in_progress';

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setClientNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [running]);

  if (!visit) return '';
  const serverNow = Date.parse(visit.serverNow);
  const nowMs = Math.max(clientNow + serverNow - receivedAt, serverNow);
  return formatElapsed(visitElapsedSeconds(visit, nowMs));
}
