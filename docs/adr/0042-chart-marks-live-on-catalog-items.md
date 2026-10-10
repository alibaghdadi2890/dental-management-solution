# ADR-0042: Chart marks live on catalog items and recolour retroactively

- Status: Accepted
- Date: 2026-10-08

## Context

Until feature 9 a tooth's fill meant treatment status (treated today, treated, in progress,
planned) and one red dot meant "has an active diagnosis". A dentist could see that something was
done to a tooth, not what. Feature 9 gives every diagnosis and every service its own colour, and
services an icon, so a glance says which filling, which crown, which diagnosis.

The colour has to be stored somewhere. Records already snapshot the `code` and `name` of their
catalog item (CLAUDE.md §7), because a past visit must keep saying what was done under the name it
was done under. The same could be done for a colour.

We considered:

- **Snapshot the mark on the record**, like the code and name. A clinic that later changes
  "Composite" from blue to green would then have a chart with blue fillings before the change and
  green ones after. Colour would stop meaning "which service" and start meaning "which service,
  recorded when". The legend would need two lines for one service.
- **A free colour (hex) per item.** Nothing stops two items from being two blues nobody can tell
  apart, or a colour from being the planned ring's, or unreadable under an icon.
- **Marks on the catalog item, from a fixed palette.**

## Decision

1. **The mark is a property of the catalog item, never of a record.** `procedures` and
   `diagnoses` gain `color` and `mark_priority`; `procedures` also `icon`. Records keep their
   `diagnosis_id` / `procedure_id` and their snapshot of code and name; the chart resolves colour
   and icon through the id when it derives.
2. **Changing a mark in the Catalog recolours every chart, past and present.** That is the
   intent: a colour identifies an item, today. The snapshot name and code on the records do not
   change.
3. **A colour is one of sixteen palette keys** (`MARK_COLORS` in `@dcm/contracts`), never a hex
   value. The theme defines each key once, in four variants: the fill of work done today, the
   mid-tone of earlier work, a strong variant for edges and text, and the colour of an icon on
   the fill. A spec checks them against each other, the card surface and the chart's rings.
   There is no free colour input. An icon is one of twelve (`MARK_ICONS`).
4. **Who has a mark.** A diagnosis is always on a tooth, so it always has a colour (`NOT NULL`).
   A service charged per tooth always has a colour (a CHECK holds that) and may have an icon. A
   service on a jaw or the whole mouth is never drawn on a tooth: a new one has no mark, and what
   is sent for it is ignored. One that was charged per tooth and is moved off the tooth **keeps**
   its mark: the tooth records made with it still point at it and are still drawn in its colour.
   The Catalog shows no mark for it.
5. **A row is never colourless.** A new row without a colour gets the key its catalog uses least
   (`leastUsedMarkColor`, the same pure function in the API and the SPA). The default catalog
   assigns a colour to every row that needs one, and migration 0039 gave existing catalogs the
   palette in order, round-robin, per tenant.
6. **Colour is identity; status is a second cue.** On the chart a fill's colour says which item;
   its tone says when: saturated with a strong edge for today, the mid-tone for before. Planned
   and in-progress work are rings around the tooth, never fills. The two are never mixed.
7. **The chart read carries the marks.** `GET /clinical/patients/:id/chart` answers `marks`: the
   mark of every catalog item its records point at, **inactive and deleted items included**, so an
   old service still has its colour and the SPA runs the same `deriveChart` as the API.
   `mark_priority` (0–9, default 5) decides which marks show first when a tooth has more than fit;
   ties go to the most recent.

## Consequences

- One query per catalog is added to the chart read.
- A clinic cannot keep "the old colour" for old work. If two things must look different on the
  chart they are two catalog items.
- Deleting a catalog row that records use is already refused (it can only be deactivated), so a
  mark is never lost under a record. A row deleted before any record used it has no chart to be
  on.
- Marks are edited with the rest of the row, in the Catalog's batch save, under `catalog:write`,
  and audited in the row's before and after like every other field.
- Sixteen colours is the limit of what can be told apart at 12 px. A catalog with more than
  sixteen diagnoses or per-tooth services reuses colours; the icon, the tooltip and the legend
  tell the reused ones apart.
- Hatch patterns for colour-blind users are not done; colour is never the only cue (services have
  an icon, every item is named in the tooltip and the legend).
