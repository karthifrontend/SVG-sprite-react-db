// User Guide side panel with framework tabs and copy buttons.
// Mirrors the "react app with MS" reference: a slide-in drawer with
// step-by-step sections, framework code samples, and a pro-tips list.
import { useEffect, useState } from "react";
import { copyToClipboard } from "../../utils/sprite";

type FrameworkId = "html" | "react" | "vue" | "angular" | "svelte" | "nextjs";

const FRAMEWORK_TABS: { id: FrameworkId; label: string }[] = [
  { id: "html", label: "HTML" },
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "angular", label: "Angular" },
  { id: "svelte", label: "Svelte" },
  { id: "nextjs", label: "Next.js" },
];

const CODE_SAMPLES: Record<FrameworkId, { file: string; body: string }> = {
  html: {
    file: "index.html",
    body: `<!-- 1. Paste sprite.svg at the top of <body> -->
<body>
  <svg aria-hidden="true" style="width: 0; height: 0; position: absolute;">
    <!-- Sprite definitions, including gradients, go here -->
  </svg>

  <!-- 2. Use any icon anywhere -->
  <svg class="icon" width="24" height="24">
    <use href="#icon-home"></use>
  </svg>

  <!-- 3. Style with CSS (Including Gradients!) -->
  <style>
    .icon { color: #334155; }
    .icon:hover { color: #4f46e5; }

    /* Apply a gradient to an icon using the CSS variable */
    .icon-gradient {
      --icon-color: url(#grad-id);
    }
  </style>
</body>`,
  },
  react: {
    file: "Icon.jsx",
    body: `// 1. Place sprite.svg in /public folder

// 2. Create Icon component
function Icon({ name, size = 24, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      className={\`icon \${className}\`}
      aria-hidden="true"
    >
      <use href={\`/sprite.svg#\${name}\`} />
    </svg>
  );
}

// 3. Usage
<Icon name="icon-home" size={32} />
<Icon name="icon-search" className="text-blue-500" />
<Icon name="icon-star" style={{ "--icon-color": "url(#grad-id)" }} />`,
  },
  vue: {
    file: "SvgIcon.vue",
    body: `<!-- 1. Place sprite.svg in /public folder -->

<template>
  <svg
    :width="size"
    :height="size"
    class="svg-icon"
    aria-hidden="true"
  >
    <use :href="\`/sprite.svg#\${name}\`" />
  </svg>
</template>

<script setup>
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 24 }
});
</script>

<!-- Usage:
<SvgIcon name="icon-home" :size="32" />
<SvgIcon name="icon-star" style="--icon-color: url(#grad-id);" />
-->`,
  },
  angular: {
    file: "svg-icon.component.ts",
    body: `// 1. Place sprite.svg in /src/assets

import { Component, Input } from '@angular/core';

@Component({
  selector: 'svg-icon',
  standalone: true,
  template: \`
    <svg [attr.width]="size" [attr.height]="size"
         class="svg-icon" aria-hidden="true">
      <use [attr.href]="'/assets/sprite.svg#' + name">
      </use>
    </svg>
  \`,
  styles: [\`.svg-icon { display: inline-block; }\`]
})
export class SvgIconComponent {
  @Input() name = '';
  @Input() size = 24;
}

// Usage:
// <svg-icon name="icon-home" [size]="32"></svg-icon>`,
  },
  svelte: {
    file: "Icon.svelte",
    body: `<!-- 1. Place sprite.svg in /static folder -->

<script>
  export let name = '';
  export let size = 24;
</script>

<svg
  width={size}
  height={size}
  class="svg-icon"
  aria-hidden="true"
>
  <use href={\`/sprite.svg#\${name}\`} />
</svg>

<style>
  .svg-icon { display: inline-block; color: inherit; }
</style>

<!-- Usage: <Icon name="icon-home" size={32} /> -->`,
  },
  nextjs: {
    file: "components/Icon.tsx",
    body: `// 1. Place sprite.svg in /public folder

interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

export default function Icon({
  name,
  size = 24,
  className = ""
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={\`inline-block \${className}\`}
      aria-hidden="true"
    >
      <use href={\`/sprite.svg#\${name}\`} />
    </svg>
  );
}

// Usage (App Router - Server Component safe):
// <Icon name="icon-home" size={32} />`,
  },
};

const PRO_TIPS: { icon: string; html: string }[] = [
  {
    icon: "🎨",
    html: 'Use <code class="guide-code">color: currentColor</code> in your CSS — icons inherit their parent\'s text color automatically.',
  },
  {
    icon: "✨",
    html: '<strong>New: Gradients!</strong> Apply gradients to icons by setting <code class="guide-code">--icon-color: url(#grad-id)</code> in CSS. The generated sprite natively supports this!',
  },
  {
    icon: "📐",
    html: 'Icons scale perfectly via <code class="guide-code">width</code> and <code class="guide-code">height</code> — they\'re vector, so no quality loss at any size.',
  },
  {
    icon: "♿",
    html: 'Add <code class="guide-code">aria-hidden="true"</code> to decorative icons or <code class="guide-code">role="img"</code> + <code class="guide-code">aria-label</code> for meaningful ones.',
  },
  {
    icon: "🔄",
    html: '<strong>"Update Existing"</strong> mode merges new symbols with the base sprite — duplicate ids are overwritten, existing ids preserved.',
  },
  {
    icon: "⚡",
    html: 'One sprite file = one HTTP request for all icons. Far better performance than individual SVG or icon font files.',
  },
];

function BookOpenIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  );
}

function CloseIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

type UserGuidePanelProps = {
  isOpen?: boolean;
  onClose?: () => void;
};

function UserGuidePanel({ isOpen = false, onClose }: UserGuidePanelProps) {
  const [activeTab, setActiveTab] = useState<FrameworkId>("html");
  const [copyingTab, setCopyingTab] = useState<FrameworkId | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  async function copyCodeSample(tab: FrameworkId) {
    const sample = CODE_SAMPLES[tab];
    if (!sample) return;
    const ok = await copyToClipboard(sample.body);
    if (!ok) return;
    setCopyingTab(tab);
    setTimeout(() => setCopyingTab((current) => (current === tab ? null : current)), 1500);
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 opacity-100 backdrop-blur-sm transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="User Guide"
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-200/50">
              <BookOpenIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">User Guide</h2>
              <p className="text-[11px] text-slate-400">Step-by-step instructions</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-600"
            aria-label="Close guide"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-extrabold text-indigo-600">
                1
              </span>
              <h3 className="text-sm font-bold text-slate-800">Upload SVG Icons</h3>
            </div>
            <div className="ml-9 space-y-3 text-[13px] leading-relaxed text-slate-600">
              <p>
                Choose <strong className="text-slate-700">Create New</strong> to build a
                fresh sprite from scratch, or <strong className="text-slate-700">Update Existing</strong> to
                add icons to an existing sprite file.
              </p>
              <p>
                <strong className="text-slate-700">Drag &amp; drop</strong> your{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-indigo-600">.svg</code>{" "}
                files onto the upload zone, or click it to browse and select files.
              </p>
              <p>Review the staged files list and clear all before generating.</p>
              <div className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">
                <strong>💡 Tip:</strong> File names become symbol IDs. Use clean names
                like{" "}
                <code className="rounded bg-white/70 px-1 py-0.5 font-mono">arrow-right.svg</code>.
              </div>
            </div>
          </section>

          <hr className="border-slate-100" />

          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-extrabold text-emerald-600">
                2
              </span>
              <h3 className="text-sm font-bold text-slate-800">What You Get</h3>
            </div>
            <div className="ml-9 space-y-3 text-[13px] leading-relaxed text-slate-600">
              <p>
                A <strong className="text-slate-700">ZIP bundle</strong> containing:
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-2.5">
                  <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-500">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-indigo-600">
                    sprite.svg
                  </code>
                  <span className="text-slate-500">— Your compiled SVG sprite</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-500">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                  </span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-indigo-600">
                    demo.html
                  </code>
                  <span className="text-slate-500">— Interactive preview page</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-rose-50 text-rose-500">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-indigo-600">
                    sprite-preview.png
                  </code>
                  <span className="text-slate-500">— Screenshot for docs/sharing</span>
                </li>
              </ul>
            </div>
          </section>

          <hr className="border-slate-100" />

          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-extrabold text-violet-600">
                3
              </span>
              <h3 className="text-sm font-bold text-slate-800">Pro Tips</h3>
            </div>
            <div className="ml-9 space-y-2">
              {PRO_TIPS.map((tip) => (
                <div key={tip.icon} className="guide-tip-card">
                  <span className="guide-tip-icon">{tip.icon}</span>
                  <span dangerouslySetInnerHTML={{ __html: tip.html }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

export default UserGuidePanel;
