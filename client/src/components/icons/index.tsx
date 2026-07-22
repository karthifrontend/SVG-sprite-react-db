// Reusable SVG icons used across the compiler UI. Each icon accepts
// an optional `className` so consumers can size/colour them with
// Tailwind utilities. All icons are simple stroked paths that share
// a 24×24 viewBox for consistency.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  className?: string;
};

const ICON_BASE = {
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function CloseIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function SearchIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function DuplicateIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

export function UnlockIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M8 11V7a4 4 0 118 0m-4 8v2" />
      <path d="M6 19h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  );
}

export function LockIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 118 0v4" />
    </svg>
  );
}

export function ChevronDoubleLeftIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    </svg>
  );
}

export function RefreshIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-3M20 14a8 8 0 01-14 3" />
    </svg>
  );
}

export function ClipboardIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h2" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}

export function PlayCircleIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  // Plain tick / checkmark stroke. Used by the LiveDemo "Save
  // Changes" button to communicate "commit pending edits"
  // without leaning on the play-circle metaphor (which conflicts
  // with the demo / preview intent of the surrounding modal).
  // Painted via `currentColor` so it inherits the host's text
  // colour (e.g. white on the emerald-600 "Save Changes" pill).
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function EyeIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PencilIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function TrashIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
    </svg>
  );
}

export function SadFaceIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
      <path d="M8.5 15.5a4 4 0 017 0" />
    </svg>
  );
}

export function InfoIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronUpIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function DownloadIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
      <path d="M7 10l5 5 5-5" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function FolderIcon({ className = "w-4 h-4", ...rest }: IconProps) {
  return (
    <svg {...ICON_BASE} className={className} {...rest}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}
