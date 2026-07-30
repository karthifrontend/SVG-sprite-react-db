// Tiny reusable pill that surfaces a sprite library's visibility as
// "Private" or "Public". Lives in its own file so the LiveDemo header and
// the LibraryPanel rows can stay perfectly aligned — same border, fill,
// text colour, icon, and label everywhere the badge is shown.
import { EyeIcon, EyeOffIcon } from "./icons";

type VisibilityBadgeProps = {
  isPublic: boolean;
  // Tooltip shown on hover. Both LibraryPanel variants pass distinct
  // strings ("Only you can see…" vs "Private — only the owner…"), and
  // LiveDemo passes "Anyone with access…" / "Only you can view…".
  title: string;
  // Used by LibraryPanel rows where the badge sits inside a tightly
  // packed card header and needs a slightly smaller font to fit
  // beside its sibling chips (e.g. `v3` chips, "Latest" tags). The
  // icon, colors, and label casing are identical to `default` — only
  // the font size differs between the two sizes. LiveDemo passes
  // "default".
  size?: "default" | "compact";
};

const SIZE_CLASSES: Record<NonNullable<VisibilityBadgeProps["size"]>, string> = {
  // Modal header — sits next to a `text-lg` title, so a slightly
  // larger / non-uppercase treatment reads cleaner.
  default:
    "text-[11px] font-semibold tracking-wide px-2 py-0.5",
  // Side-panel rows — sits next to `text-sm` headings and other
  // micro-pills (`v3` chips, "Latest" tags). Kept consistent with the
  // default size: same label casing ("Public" / "Private" — first
  // letter capital only) and only a slightly smaller font to fit
  // beside its sibling chips. Both badge variants use the SAME icon
  // and color treatment — only the font size varies between sizes.
  compact:
    "text-[10px] font-semibold tracking-wide px-2 py-0.5",
};

function VisibilityBadge({
  isPublic,
  title,
  size = "default",
}: VisibilityBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border ${
        SIZE_CLASSES[size]
      } ${
        isPublic
          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
          : "border-amber-300 bg-amber-50 text-amber-700"
      }`}
      title={title}
    >
      {isPublic ? (
        <EyeIcon className="h-3 w-3 shrink-0 text-indigo-500" />
      ) : (
        <EyeOffIcon className="h-2.5 w-2.5 shrink-0 text-amber-700" />
      )}
      {isPublic ? "Public" : "Private"}
    </span>
  );
}

export default VisibilityBadge;