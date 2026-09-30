import type { Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { visitQuery } from './visits-api';

/** The fields a running timer reads: a `Visit`, or a `LiveVisitRef` (never completed). */
export type TimerClock = Pick<
  Visit,
  'status' | 'startedAt' | 'pausedAt' | 'pausedSeconds' | 'serverNow'
> & { completedAt?: string | null };

const TICK_MS = 1000;

/**
 * Seconds of work at `nowMs` (server time), the API's `elapsedSeconds` rule
 * (`clinical/domain/visit-timer.ts`, W19): from `startedAt` to where the clock stopped
 * (`completedAt`, else `pausedAt`, else now), less the paused time; whole seconds, never negative.
 */
export function visitElapsedSeconds(clock: TimerClock, nowMs: number): number {
  const stoppedAt = clock.completedAt ?? clock.pausedAt;
  const endMs = stoppedAt === null ? nowMs : Date.parse(stoppedAt);
  const whole = Math.max(0, Math.floor((endMs - Date.parse(clock.startedAt)) / 1000));
  return Math.max(0, whole - clock.pausedSeconds);
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
 * A running timer's text, rendered from the server's clock rather than the browser's:
 * `offset = serverNow − receivedAt`, where `receivedAt` is when that data arrived (the query's
 * `dataUpdatedAt`). While `in_progress` it re-renders exactly when the elapsed second changes;
 * paused or completed, it shows the frozen value. Never earlier than `serverNow`, so a resume
 * doesn't jump back before the first tick. Empty until there is a clock. The live-visit pill
 * calls this with a `LiveVisitRef`.
 */
export function useElapsedText(clock: TimerClock | undefined, receivedAt: number): string {
  const [clientNow, setClientNow] = useState(() => Date.now());
  const running = clock?.status === 'in_progress';
  const serverNow = clock?.serverNow;
  const startedAt = clock?.startedAt;

  useEffect(() => {
    if (!running || serverNow === undefined || startedAt === undefined) return;
    const offset = Date.parse(serverNow) - receivedAt;
    const started = Date.parse(startedAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const intoSecond = (((Date.now() + offset - started) % TICK_MS) + TICK_MS) % TICK_MS;
      timer = setTimeout(() => {
        setClientNow(Date.now());
        schedule();
      }, TICK_MS - intoSecond);
    };
    schedule();
    return () => {
      clearTimeout(timer);
    };
  }, [running, serverNow, startedAt, receivedAt]);

  if (!clock) return '';
  const serverNowMs = Date.parse(clock.serverNow);
  const nowMs = Math.max(clientNow + serverNowMs - receivedAt, serverNowMs);
  return formatElapsed(visitElapsedSeconds(clock, nowMs));
}

/** The workspace's timer for one visit, from the visit query's data and arrival time. */
export function useVisitTimer(visitId: string): string {
  const { data, dataUpdatedAt } = useQuery(visitQuery(visitId));
  return useElapsedText(data, dataUpdatedAt);
}
