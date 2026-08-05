// Primary "Generate Sprite" button. Reflects busy/disabled state and triggers compilation on click.
type GenerateButtonProps = {
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  label?: string;
};

function GenerateButton({ disabled, busy, onClick, label = "Generate Sprite" }: GenerateButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2.5 rounded-xl py-3.5 px-6 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 disabled:cursor-not-allowed"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span>{busy ? "Generating..." : label}</span>
    </button>
  );
}

export default GenerateButton;
