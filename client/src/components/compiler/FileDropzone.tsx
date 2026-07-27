// File drop zone with click and keyboard activation.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

type FileDropzoneProps = {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onClickBrowse: () => void;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  label?: string;
};

function FileDropzone({
  inputRef,
  onDrop,
  onDragOver,
  onClickBrowse,
  onFileChange,
}: FileDropzoneProps) {
  const [isActive, setIsActive] = useState(false);
  const dragCounter = useRef(0);

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current += 1;
    if (event.dataTransfer?.items?.length) {
      setIsActive(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setIsActive(false);
    onDrop(event);
  }

  return (
    <div className="mb-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload SVG files by dragging here or clicking to browse"
        onClick={onClickBrowse}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClickBrowse();
          }
        }}
        onDragEnter={handleDragEnter}
        onDragOver={onDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-10 text-center transition-all duration-200 hover:border-indigo-400 hover:bg-indigo-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          isActive ? "dropzone-active" : ""
        }`}
      >
        <input
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          ref={inputRef}
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        <div className="dropzone-icon mx-auto mb-4 h-12 w-12 text-slate-400 transition-all duration-200">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              d="M28 8H12a4 4 0 00-4 4v24a4 4 0 004 4h24a4 4 0 004-4V20L28 8z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline points="28,8 28,20 40,20" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="24" y1="26" x2="24" y2="36" strokeLinecap="round" />
            <polyline points="19,31 24,26 29,31" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="dropzone-label text-sm font-semibold text-slate-600 transition-colors duration-200">
          Drag &amp; drop SVG files here
        </p>
        <p className="mt-1.5 text-xs text-slate-400">
          or{" "}
          <span className="font-medium text-indigo-500 underline underline-offset-2">click to browse</span>
        </p>
      </div>
    </div>
  );
}

export default FileDropzone;
