# ADR-0077: Dentists are not on payroll

- Status: Accepted
- Date: 2026-11-06

## Context

Dentists are paid through compensation (ADR-0058 to ADR-0060). If a dentist were also an
employee, their pay could be counted twice in Expenses. An employee may optionally be linked to a
staff user, for example so the receptionist's account and payroll record are known to be the same
person.

## Decision

1. Payroll is for every employee who is not a dentist. A staff profile whose practitioner type is
   `dentist` can't be linked to an employee (422 `payroll.dentist_not_linkable`). The link picker
   (`GET /payroll/staff`) lists only active non-dentists.
2. A staff user is linked to one live employee at most (unique index; 409
   `payroll.user_already_linked`). A link never changes roles or access.
3. Nothing happens by itself when a linked user is later deactivated or becomes a dentist. The
   employee screen shows a notice (`linkNotice`), and the owner decides whether to unlink the
   user or mark the employee as left.
4. `payroll` reads staff through `UsersService.staffSummaries()`, an ungated building block
   (type, active flag, name); `payroll` gates its own routes.

## Consequences

- A dentist who also does admin work is still paid only through compensation (e.g. with a fixed
  component).
- A practitioner type changed to dentist while linked is caught by the notice, not by a veto.
