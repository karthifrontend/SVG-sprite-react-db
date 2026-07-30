// Toast formatting helpers. Library names are user-controlled strings that can
// be very long (the user can name a bundle anything they like), and the toast
// banner has a fixed max-width. To keep the surrounding text — version number,
// count, action verbs — fully visible, we truncate ONLY the library-name
// portion of a toast message. Surrounding text (e.g. " v4 (skipped 2
// duplicates).", " downloaded successfully.") is left untouched, so the user
// still gets the full version + action context.

// Cap on a library name's length inside a toast. Picked so the longest
// realistic name still fits inside the toast card with the surrounding
// text. If the name is shorter than this it's returned unchanged.
const MAX_LIB_NAME_LENGTH = 20;

// Truncate a library/bundle name to `MAX_LIB_NAME_LENGTH` chars and append a
// horizontal ellipsis. Returns the input unchanged when it's already short
// enough, so short names display verbatim. Whitespace at the edges is
// trimmed first so a padded-out short name doesn't get ellipsised.
export function truncateLibName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (trimmed.length <= MAX_LIB_NAME_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_LIB_NAME_LENGTH)}…`;
}
