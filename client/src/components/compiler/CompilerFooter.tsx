function CompilerFooter() {
  return (
    <footer className="mt-7 text-center animate-fade-in-up" style={{ animationDelay: ".15s" }}>
      <p className="text-xs text-slate-400">
        Built with
        <span className="mx-0.5 inline-block">
          <svg className="-mt-0.5 ml-1 inline h-3 w-3 text-rose-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53L12 21.35z" />
          </svg>
        </span>
        using <strong className="text-slate-500">svg-sprite</strong> · Created by{" "}
        <strong className="text-slate-500">Ariharan S</strong>
      </p>
    </footer>
  );
}

export default CompilerFooter;
