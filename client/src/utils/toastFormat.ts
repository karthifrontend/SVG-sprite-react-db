//If the name is shorter than this it's returned unchanged.
const MAX_LIB_NAME_LENGTH = 20;

// Truncate a library/bundle name to `MAX_LIB_NAME_LENGTH` chars and append a horizontal ellipsis.
export function truncateLibName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (trimmed.length <= MAX_LIB_NAME_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_LIB_NAME_LENGTH)}…`;
}
