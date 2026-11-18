# ADR-0092: Dashboard permissions

- Status: Accepted
- Date: 2026-11-18

## Context

The owner wants the dashboards for themselves and the admin, and to grant them to others. The
operational one must show a front-desk lead the whole clinic's counts without any money.

## Decision

1. Two permissions in a new capability group `dashboard`:
   - `dashboard:financial` (_See financial dashboard_), which implies `finance:read`: it is money
     across patients;
   - `dashboard:operational` (_See operational dashboard_): counts, rates and times for the whole
     clinic, whatever the user's own visit scope. No money.
2. Defaults: owner and admin hold both; no other role holds either. Migration 0060 only adds them
   to the `owner` and `admin` roles of every clinic and to their templates.
3. Inside the Financial tab each part still needs its home permission: expense parts
   `expense:read`, salaries `payroll:read`, dentist compensation `compensation:manage`, lab
   accounts `lab:money_read`; the Operational labs card `lab:read`. Every service re-checks.
4. Aggregates are clinic-wide by design; the lists a number opens keep the caller's own
   permissions and visit scope.

## Consequences

- A platform admin acting in a clinic holds both, but never complete cost (ADR-0088).
