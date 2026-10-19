# Service icons on the tooth, and services without a colour

Date: 2026-10-19. Module: `clinical` (API, contracts, SPA). ADR-0054 amends ADR-0042.

## Why

A service's icon was drawn only on the small chip in the band above or below the tooth, so it
was barely visible. And every per-tooth service had to have a colour, so in the Both view a
service always hid the diagnosis colour under it. A clinic wants to see both: the diagnosis
colour on the tooth and, inside it, the icon of what was done.

## Decisions

- **D1: a per-tooth service has a colour, an icon, or both — never neither.** The CHECK
  `procedures_mark_per_tooth` allows a per-tooth row whose `color` or `icon` is set (migration
  0049). A diagnosis still always has a colour.
- **D2: the save input.** `color` not sent keeps the stored colour (a new per-tooth row gets the
  least used one, as before). `color: null` means no colour when the row has, or keeps, an icon.
  A per-tooth row sending `color: null` and `icon: null` is a validation error (`color`, 400). A
  `color: null` that would still leave the row with neither (no icon sent or stored) keeps the
  old meaning: the stored colour, or the least used one.
- **D3: the icon is drawn inside the tooth.** A painted area (`Fill`) carries the icon of the
  service that painted it. Simple mode: the icon is drawn large inside the body (about 70 % of
  its width). Surface mode: the first whole-tooth service with an icon has its icon drawn across
  the 3×3 crown, with a halo in the surface colour so it reads over mixed cells; that service
  then leaves the band. Surface-only services paint their surfaces as before.
- **D4: Services view.** A service with no colour paints a plain body (or plain surfaces) and
  its icon.
- **D5: Both view.** The first service still paints. If it has a colour the tooth takes it, with
  its icon. If it has none, the first diagnosis on the tooth (simple mode), or on the surface
  (surface mode), gives the colour, at today's tone, and the service's icon is drawn on it. The
  diagnosis dots do not change.
- **D6: icon colour.** On a catalog colour: the palette's `on` for today, `strong` for before
  (the `color` `fillStyle` already sets). On a plain fill: ink with a 1.5 px strong edge for
  today, muted ink for before.
- **D7: chips.** A chip with no colour is a plain box with its icon in ink (muted for before).
  `ServiceMark` and the legend show icon-only services. The compact chart's dot for one is the
  plain dot it already draws for a colourless item.
- **D8: the Catalog.** The colour picker gets **No colour**, enabled only when the row has an
  icon. The icon picker's **None** is disabled while the row has no colour. The Mark column shows
  the pickers for every per-tooth service. A row that becomes per-tooth with neither gets the
  least used colour.
- **D9: the selected-tooth panel.** Simple mode draws the icon large in its 52×64 body. Surface
  mode keeps its surface letters; the band's marks are listed under it as today.

## Out of scope

The default catalog keeps its colours; a clinic removes a colour in the Catalog.
