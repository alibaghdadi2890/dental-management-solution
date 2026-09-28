/** Up to two initials for avatars ("Dr. Ana Reyes" → "AR"). */
export function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** The first word of a name, as the list's "via {first name}" line shows it ("Maria Haddad" →
 * "Maria"); the whole name when it has no spaces. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
