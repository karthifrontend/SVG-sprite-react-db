// Tiny reusable icon badge that surfaces a sprite library's visibility as "Private" or "Public". 
import { EyeIcon, EyeOffIcon } from "./icons";

type VisibilityBadgeProps = {
  isPublic: boolean;
  title: string;
  size?: "default" | "compact";
};

const SIZE_CLASSES: Record<NonNullable<VisibilityBadgeProps["size"]>, string> = {
  default:
    "text-[11px] font-semibold tracking-wide px-2 py-0.5",
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