# ADR-0054: A service's icon is drawn inside the tooth, and a service may have no colour

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0042 §4 and §6

## Context

ADR-0042 gave every per-tooth service a colour (a CHECK held it) and, optionally, an icon. The
first mark on a tooth painted it; an icon showed only on the band's chips, 10 px at the root end
of the tooth, where it was hard to see. In the Both view the services painted the tooth and the
diagnoses were dots, so a treated tooth never showed its diagnosis colour. Clinics want to see
both at once: what is wrong, as the tooth's colour, and what was done, as an icon on it.

## Decision

1. **A per-tooth service has a colour, an icon or both, never neither.** The CHECK
   `procedures_mark_per_tooth` allows a per-tooth row whose `color` or `icon` is set (migration
   0049). A diagnosis always has a colour, as before.
2. **Saving.** `color` left out keeps the stored colour, or gives a new row the least used one.
   A service's `color: null` means no colour when the row has, or keeps, an icon. With neither,
   the input schema refuses the row. A `color: null` that would leave a row with neither keeps the
   colour, as before. The Catalog offers **No colour** only on a row with an icon, and disables
   the icon's **None** while the row has no colour.
3. **The icon is drawn inside the tooth.** In simple mode the service that paints the body has
   its icon drawn large in it. In surface mode the first whole-tooth service with an icon has its
   icon drawn across the crown, on a halo of the surface colour, and leaves the band. A service on
   some surfaces only paints them, as before.
4. **A service with no colour lets the diagnosis show.** In the Both view a colourless service
   takes the colour of the first diagnosis on the tooth (simple mode) or on that surface (surface
   mode), and its icon is drawn on it. A service with a colour still paints over the diagnosis.
   In the Services view a colourless service is a plain tooth with its icon.
5. **The status cue of a colourless service** is the icon's ink: full ink with a strong edge for
   today, muted ink for before (ADR-0042 §6 keeps holding for coloured marks).

## Consequences

- Whether the diagnosis shows under a service is a catalog choice, per service: a clinic that
  wants it removes the service's colour.
- On a colourless service over a diagnosis, the tone is the diagnosis's (always "today"), so the
  done-before cue of that service is in the tooltip only.
- A whole-tooth service's icon on the crown has no ring of its own when the legend highlights it;
  the surfaces it painted are ringed.
- The default catalog keeps its colours.
