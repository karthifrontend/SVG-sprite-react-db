// Mode toggle between "Create New Sprite" and "Update Existing Sprite".
export type CompilerMode = "new" | "update";

type ModeTabsProps = {
  value: CompilerMode;
  onChange: (next: CompilerMode) => void;
};

const OPTIONS: { id: CompilerMode; label: string }[] = [
  { id: "new", label: "Create New Sprite" },
  { id: "update", label: "Update Existing Sprite" },
];

function ModeTabs({ value, onChange }: ModeTabsProps) {
  return (
    <div
      className="mb-6 flex rounded-xl bg-slate-100 p-1"
      role="tablist"
      aria-label="Sprite mode"
    >
      {OPTIONS.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
              isActive
                ? "bg-white text-indigo-600 shadow-sm ring-1 ring-slate-900/5"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default ModeTabs;
