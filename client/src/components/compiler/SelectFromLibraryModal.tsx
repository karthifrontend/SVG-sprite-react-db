// "Select a sprite from the Library" modal. Mirrors the LibraryPanel grouping (Public / Private accordions) but lets the user pick a specific version and load it into the base sprite section. Visually similar to PasteIconsModal so the two flows feel like siblings.
import { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import { useLibrary } from "../../hooks/useLibrary";
import { useAuth } from "../../context/AuthContext";
import type { SpriteSummary } from "../../api/sprites";
import { ChevronDownIcon, ChevronUpIcon } from "../icons";

type LibraryTab = "private" | "public";

type SelectFromLibraryModalProps = {
    isOpen: boolean;
    // Set while the parent is fetching the version XML and seeding the base sprite. While `busy` is true, every Load button is disabled and the modal can't be closed.
    busy: boolean;
    onClose: () => void;
    // Called with the chosen version. The parent is responsible for fetching the full XML (via `getSpriteById`), building the `File`, and seeding `baseSpriteFile` / `activeBundleName` / `liveDemoSource` / etc.
    onLoad: (summary: SpriteSummary) => void;
};

type VersionRow = {
    id: string;
    version: number;
    symbolCount: number;
    updatedAt?: string;
    isPublic: boolean;
    isOwner: boolean;
    summary: SpriteSummary;
};

type BundleGroup = {
    bundleName: string;
    isPublic: boolean;
    isOwner: boolean;
    versions: VersionRow[];
};

export default function SelectFromLibraryModal({
    isOpen,
    busy,
    onClose,
    onLoad,
}: SelectFromLibraryModalProps) {
    const { currentUser } = useAuth();
    const { sprites, loading, refetch } = useLibrary(!!currentUser);

    // Always pull a fresh snapshot when the modal opens so the user sees new saves / renames / deletes that landed while the modal was closed.
    useEffect(() => {
        if (isOpen && currentUser) {
            void refetch();
        }
    }, [isOpen, currentUser, refetch]);

    // Build the same (Public | Private) bucket structure the LibraryPanel renders, with the same newest-first ordering inside each version list. This keeps the modal visually consistent with the sidebar so the user doesn't have to re-learn the layout.
    const { publicGroups, privateGroups } = useMemo(() => {
        const byName = new Map<string, BundleGroup>();
        for (const sprite of sprites) {
            const key = (sprite.bundleName || sprite.name || "").trim().toLowerCase();
            if (!key) continue;
            if (!byName.has(key)) {
                byName.set(key, {
                    bundleName: sprite.bundleName || sprite.name,
                    isPublic: false,
                    // Owned-only here matches the LibraryPanel's "owners can load to update" rule. Foreign public bundles are still readable but can't be loaded as a base sprite for editing, so we hide them entirely.
                    isOwner: false,
                    versions: [],
                });
            }
            const group = byName.get(key)!;
            const isPublic = !!sprite.isPublic;
            const isOwner = sprite.isOwner !== false;
            if (isPublic) group.isPublic = true;
            if (isOwner) group.isOwner = true;
            group.versions.push({
                id: sprite._id,
                version: sprite.version ?? 1,
                symbolCount: sprite.symbolCount,
                updatedAt: sprite.updatedAt,
                isPublic,
                isOwner,
                summary: sprite,
            });
        }
        for (const group of byName.values()) {
            group.versions.sort((a, b) => b.version - a.version);
        }
        const all = Array.from(byName.values());
        return {
            // Public tab only shows bundles the current user owns/edits, matching the "owners can load to update" rule. Foreign public bundles are still readable elsewhere but can't be loaded as a base sprite for editing, so we hide them entirely here.
            publicGroups: all.filter((g) => g.isPublic && g.isOwner),
            privateGroups: all.filter((g) => !g.isPublic),
        };
    }, [sprites]);

    // Tab state. Default to Private (the more common case in a personal workflow); Public stays one click away.
    const [activeTab, setActiveTab] = useState<LibraryTab>("private");

    // Which bundle is currently expanded to show its versions. Null means "header only", no version rows visible. Starts null so every library card is collapsed when the modal opens; the user clicks a card to peek at its versions.
    const [expandedBundle, setExpandedBundle] = useState<string | null>(null);

    // Reset to fully-collapsed every time the modal opens so a previous session's choice doesn't leak across opens.
    useEffect(() => {
        if (isOpen) {
            setExpandedBundle(null);
        }
    }, [isOpen]);

    function toggleBundle(name: string) {
        setExpandedBundle((prev) => (prev === name ? null : name));
    }

    function handleLoad(version: VersionRow) {
        if (busy) return;
        onLoad(version.summary);
        onClose();
    }

    function renderGroup(group: BundleGroup) {
        const isExpanded = expandedBundle === group.bundleName;
        return (
            <div
                key={group.bundleName}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
                <button
                    type="button"
                    onClick={() => toggleBundle(group.bundleName)}
                    disabled={busy}
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 disabled:opacity-50"
                    aria-expanded={isExpanded}
                >
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <h4 className="truncate text-sm font-bold text-slate-800">
                                {group.bundleName}
                            </h4>
                        </div>
                        <span className="text-[11px] font-medium text-slate-400">
                            {group.versions.length}{" "}
                            {group.versions.length === 1 ? "version" : "versions"}
                        </span>
                    </div>
                    {isExpanded ? (
                        <ChevronUpIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                        <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                </button>

                {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/40">
                        {group.versions.map((version) => (
                            <div
                                key={version.id}
                                className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0"
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="inline-flex shrink-0 items-center rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                        v{version.version}
                                    </span>
                                    <span className="truncate text-[11px] text-slate-500">
                                        {version.symbolCount}{" "}
                                        {version.symbolCount === 1 ? "symbol" : "symbols"}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleLoad(version)}
                                    disabled={busy}
                                    className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-indigo-100 hover:text-indigo-700 disabled:opacity-50"
                                >
                                    {"Update"}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Tabbed panel that mirrors the ModeTabs UI (slate-100 track, white active pill with indigo text and ring). Renders the list for the selected tab only, so Private/Public no longer sit stacked as accordions.
    function renderTabs() {
        const tabs: { id: LibraryTab; label: string; list: BundleGroup[]; emptyHint: string }[] = [
            {
                id: "private",
                label: "Private",
                list: privateGroups,
                emptyHint: "No private libraries.",
            },
            {
                id: "public",
                label: "Public",
                list: publicGroups,
                emptyHint: "No public libraries.",
            },
        ];
        const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
        return (
            <div>
                <div
                    className="mb-3 flex rounded-xl bg-slate-100 p-1"
                    role="tablist"
                    aria-label="Library visibility"
                >
                    {tabs.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                                    isActive
                                        ? "bg-white text-indigo-600 shadow-sm ring-1 ring-slate-900/5"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
                <div role="tabpanel" aria-label={active.label}>
                    {active.list.length === 0 ? (
                        <p className="py-2 pl-1 text-[11px] text-slate-400">
                            {active.emptyHint}
                        </p>
                    ) : (
                        <div className="space-y-2 pb-1">
                            {active.list.map(renderGroup)}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={busy ? () => undefined : onClose}
            maxWidth="max-w-md"
            ariaLabel="Select a sprite from the library"
        >
            <div className="p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-900">
                            Select a sprite from the library
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                        aria-label="Close select from library dialog"
                    >
                        <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                <p className="mt-1 text-[11px] text-slate-500">
                    Choose a version to load into the base sprite section.
                </p>

                <div className="custom-scrollbar mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                    {!currentUser && (
                        <p className="py-3 text-center text-[11px] text-slate-500">
                            Sign in to load a saved library.
                        </p>
                    )}

                    {currentUser && loading && sprites.length === 0 && (
                        <div className="space-y-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="skeleton-shimmer h-12 rounded-xl" />
                            ))}
                        </div>
                    )}

                    {currentUser && !loading && sprites.length === 0 && (
                        <p className="py-4 text-center text-[11px] text-slate-500">
                            No saved libraries yet.
                        </p>
                    )}

                    {currentUser && sprites.length > 0 && renderTabs()}
                </div>
            </div>
        </Modal>
    );
}
