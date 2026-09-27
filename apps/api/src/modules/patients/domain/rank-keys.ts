/**
 * Integer sort keys for `search`'s rank ordering (design Q7): `keys[i]` is the key of `ids[i]`
 * (same length), everyone not among `ids` gets `restKey`; ascending keys, then name, then id.
 * `sort=dentist` builds them here (`dentistRank`); `billing` builds them for `sort=balance`.
 */
export interface PatientRankKeys {
  ids: readonly string[];
  /** 32-bit integers. */
  keys: readonly number[];
  restKey: number;
}
