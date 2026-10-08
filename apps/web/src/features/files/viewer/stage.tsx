import type { FileOrientation } from '@dcm/contracts';
import {
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import { rotatedSize } from '../rotation';
import {
  fitScale,
  fitView,
  panBy,
  type Size,
  toggleFit,
  type View,
  ZOOM_STEP,
  zoomBy,
  zoomPercent,
} from './zoom';
import type { ImageFilters, RelativeView, StageHandle } from './stage-types';

const SWIPE_PX = 60;
const NOTHING: Size = { width: 0, height: 0 };

/**
 * One image on the viewer's stage (feature 8 §4): centred and fitted, zoomed with the wheel (at
 * the pointer), a pinch, or the toolbar; dragged to pan once it is larger than the stage;
 * double-click toggles fit and 100%. `orientation` turns it, `filters` are the X-ray reading
 * aids. A swipe across a fitted image asks for the next or the previous file. The stage owns its
 * view and reports it (`onView`), and follows another stage's when given one (`follow`, the
 * compare mode's Sync zoom).
 */
export function ImageStage({
  ref,
  src,
  label,
  orientation,
  filters,
  onView,
  follow,
  onSwipe,
  className,
}: {
  ref?: Ref<StageHandle>;
  src: string;
  /** The image's accessible name. */
  label: string;
  orientation: FileOrientation;
  filters: ImageFilters;
  onView?: (view: { percent: number; relative: RelativeView; fitted: boolean }) => void;
  follow?: RelativeView | null | undefined;
  /** `-1` towards the start of the screen, `1` towards its end, in pixels' direction. */
  onSwipe?: (direction: -1 | 1) => void;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>(NOTHING);
  const [natural, setNatural] = useState<Size>(NOTHING);
  // Null is "fitted": it follows the stage as the window, or the details panel, resizes it.
  const [custom, setCustom] = useState<View | null>(null);
  const image = rotatedSize(natural, orientation);
  const ready = natural.width > 0 && stage.width > 0;
  const view = custom ?? fitView(image, stage);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch: number | null }>({
    startX: 0,
    startY: 0,
    moved: false,
    pinch: null,
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = stageRef.current;
    // Without `ResizeObserver` (a test's DOM) the stage has no size and the image stays hidden.
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      setStage({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // A turned image is another shape: start again from the fitted view.
  const [turned, setTurned] = useState(orientation);
  if (turned !== orientation) {
    setTurned(orientation);
    setCustom(null);
  }

  const report = useCallback(
    (next: View, of: Size, within: Size) => {
      const fit = fitScale(of, within);
      onView?.({
        percent: zoomPercent(next),
        relative: { zoom: next.scale / fit, x: next.x / fit, y: next.y / fit },
        fitted: Math.abs(next.scale - fit) < 0.001,
      });
    },
    [onView],
  );

  // The view the last gesture left, until a render shows it: wheel and pinch events can come
  // several to a frame, and each must build on the one before.
  const latest = useRef<View | null>(null);
  useEffect(() => {
    latest.current = null;
  });

  const apply = useCallback(
    (change: (current: View) => View) => {
      if (!ready) return;
      const next = change(latest.current ?? view);
      latest.current = next;
      const fit = fitView(image, stage);
      setCustom(
        Math.abs(next.scale - fit.scale) < 0.001 && next.x === 0 && next.y === 0 ? null : next,
      );
      report(next, image, stage);
    },
    [ready, view, image, stage, report],
  );

  // The readout follows the fitted view too: a resize changes what "fit" is.
  const fitted = custom === null;
  const reportFitted = useEffectEvent(() => {
    if (ready && fitted) report(fitView(image, stage), image, stage);
  });
  useEffect(() => {
    reportFitted();
  }, [ready, fitted, image.width, image.height, stage.width, stage.height]);

  // Sync zoom: the other stage moved. Applied while rendering and without reporting, so the
  // two stages never echo each other.
  const [followed, setFollowed] = useState<RelativeView | null>(null);
  if (follow && follow !== followed && ready) {
    setFollowed(follow);
    const fit = fitScale(image, stage);
    setCustom(
      follow.zoom === 1 && follow.x === 0 && follow.y === 0
        ? null
        : zoomBy(
            { scale: fit * follow.zoom, x: follow.x * fit, y: follow.y * fit },
            1,
            image,
            stage,
          ),
    );
  }

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        apply((current) => zoomBy(current, ZOOM_STEP, image, stage));
      },
      zoomOut: () => {
        apply((current) => zoomBy(current, 1 / ZOOM_STEP, image, stage));
      },
      fit: () => {
        apply(() => fitView(image, stage));
      },
      actual: () => {
        apply((current) => zoomBy(current, 1 / current.scale, image, stage));
      },
    }),
    [apply, image, stage],
  );

  /** A pointer's position measured from the stage's centre. */
  const fromCentre = (clientX: number, clientY: number) => {
    const box = stageRef.current?.getBoundingClientRect();
    return box
      ? { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 }
      : { x: 0, y: 0 };
  };

  // `wheel` must be able to stop the page from scrolling: a non-passive listener.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    apply((current) =>
      zoomBy(current, factor, image, stage, fromCentre(event.clientX, event.clientY)),
    );
  });
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = {
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pinch: spread(),
    };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const distance = spread();
    if (distance !== null && gesture.current.pinch !== null && gesture.current.pinch > 0) {
      const factor = distance / gesture.current.pinch;
      gesture.current.pinch = distance;
      gesture.current.moved = true;
      apply((current) =>
        zoomBy(current, factor, image, stage, fromCentre(event.clientX, event.clientY)),
      );
      return;
    }
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) gesture.current.moved = true;
    if (custom !== null) apply((current) => panBy(current, dx, dy, image, stage));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasPinch = gesture.current.pinch !== null;
    pointers.current.delete(event.pointerId);
    gesture.current.pinch = null;
    if (pointers.current.size > 0) return;
    setDragging(false);
    // A swipe turns the page only while the image is fitted: zoomed in, a drag is a pan.
    const dx = event.clientX - gesture.current.startX;
    const dy = event.clientY - gesture.current.startY;
    if (
      !wasPinch &&
      custom === null &&
      event.pointerType !== 'mouse' &&
      Math.abs(dx) > SWIPE_PX &&
      Math.abs(dx) > Math.abs(dy) * 1.5
    ) {
      onSwipe?.(dx < 0 ? 1 : -1);
    }
  };

  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        apply((current) =>
          toggleFit(current, image, stage, fromCentre(event.clientX, event.clientY)),
        );
      }}
      className={cn(
        'relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden select-none',
        custom === null ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
    >
      <img
        src={src}
        alt={label}
        draggable={false}
        onLoad={(event) => {
          setNatural({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          });
        }}
        className={cn('absolute top-1/2 max-w-none', !ready && 'opacity-0')}
        style={{
          // Physical on purpose: the image is centred on the stage whatever the reading direction.
          left: '50%',
          width: natural.width || undefined,
          height: natural.height || undefined,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${orientation}deg)`,
          filter: `invert(${filters.invert ? 1 : 0}) brightness(${filters.brightness}) contrast(${filters.contrast})`,
        }}
      />
    </div>
  );
}
