import { createContext, type ReactNode, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

const PanelSlot = createContext<HTMLElement | null>(null);

/**
 * A screen with a right panel beside its scrolling content (the Visits list's layout): the content
 * on the left, and a slot on the right that `InPanelSlot` renders into from anywhere below — a tab
 * deep in the page can open its panel without lifting its state to the screen.
 */
export function PanelLayout({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PanelSlot.Provider value={slot}>{children}</PanelSlot.Provider>
      </div>
      {/* `contents`: the panel portalled in is a flex item of this row, like on the list pages,
          so its `max-w-[48%]` is of the screen, not of a wrapper only as wide as the panel. */}
      <div ref={setSlot} className="contents" />
    </div>
  );
}

/** Renders a `RightPanel` beside the page of the nearest `PanelLayout` (inline without one). */
export function InPanelSlot({ children }: { children: ReactNode }) {
  const slot = useContext(PanelSlot);
  return slot ? createPortal(children, slot) : children;
}
