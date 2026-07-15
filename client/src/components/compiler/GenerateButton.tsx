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
      className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 py-3.5 px-6 font-semibold text-white shadow-lg shadow-indigo-200/60 transition-all duration-200 hover:from-indigo-700 hover:to-indigo-600 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span>{busy ? "Generating..." : label}</span>
    </button>
  );
}

export default GenerateButton;
