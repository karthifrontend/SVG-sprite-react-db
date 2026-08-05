// Renders compiler header with title and description
function CompilerHeader() {
  return (
    <header className="mb-8 mt-8 text-center animate-fade-in-up">
      <div className="mb-5 inline-flex h-16 w-16 rotate-3 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-200/60 transition-transform duration-300 hover:rotate-0">
        <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">SVG Sprite Compiler</h1>
      <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-slate-500 sm:text-base">
        Upload individual SVGs and compile them into a single
        <code className="mx-1 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-indigo-600">&lt;symbol&gt;</code>
        based sprite sheet.
      </p>
    </header>
  );
}

export default CompilerHeader;
