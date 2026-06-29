import type { DownloadFocus, Region, Section, SeedFocus } from "./store";

export interface Hint {
  keys: string;
  label: string;
}

interface HelpGroup {
  title: string;
  hints: Hint[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "Navigate",
    hints: [
      { keys: "↑ ↓ ← →", label: "Navigate content and panes" },
      { keys: "↵", label: "Open" },
      { keys: "tab", label: "Switch pane" },
      { keys: "esc", label: "Back" },
      { keys: "q", label: "Quit" },
    ],
  },
  {
    title: "Search",
    hints: [
      { keys: "/", label: "Edit search" },
      { keys: "↵", label: "Run search" },
      { keys: "s", label: "Sort results" },
      { keys: "y", label: "Copy magnet" },
      { keys: "m", label: "Paste magnet" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "c", label: "Cancel or remove from list" },
      { keys: "f", label: "Retry failed" },
      { keys: "d", label: "Download again" },
      { keys: "x", label: "Clear recent" },
    ],
  },
  {
    title: "Seeding",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "c", label: "Remove from list" },
    ],
  },
];

const NAVIGATE: Hint = { keys: "↑ ↓ ← →", label: "Navigate content and panes" };

const ALWAYS: Hint = { keys: "?", label: "Keys" };

const SWITCH: Hint = { keys: "tab", label: "Switch pane" };

export function footerHints(
  region: Region,
  section: Section,
  downloadFocus?: DownloadFocus | null,
  seedFocus?: SeedFocus | null,
): Hint[] {
  if (region === "sidebar") {
    return [
      NAVIGATE,
      { keys: "↵", label: "Open" },
      SWITCH,
      ALWAYS,
      { keys: "q", label: "Quit" },
    ];
  }
  if (section === "seeding") {
    const label =
      seedFocus === "seeding" ? "Pause" : seedFocus === "missing" ? "Retry" : "Resume";
    return [{ keys: "p", label }, { keys: "c", label: "Remove" }, SWITCH, ALWAYS];
  }
  if (section === "downloads") {
    if (downloadFocus === "paused") {
      return [{ keys: "p", label: "Resume" }, { keys: "c", label: "Cancel" }, SWITCH, ALWAYS];
    }
    if (downloadFocus === "failed") {
      return [{ keys: "f", label: "Retry" }, { keys: "c", label: "Remove" }, SWITCH, ALWAYS];
    }
    if (downloadFocus === "recent") {
      return [
        NAVIGATE,
        { keys: "d", label: "Download again" },
        { keys: "c", label: "Remove" },
        { keys: "x", label: "Clear" },
        SWITCH,
        ALWAYS,
      ];
    }
    return [{ keys: "p", label: "Pause" }, { keys: "c", label: "Cancel" }, SWITCH, ALWAYS];
  }
  return [
    NAVIGATE,
    { keys: "d", label: "Download" },
    { keys: "s", label: "Sort" },
    { keys: "y", label: "Copy magnet" },
    { keys: "/", label: "Search" },
    { keys: "m", label: "Paste magnet" },
    SWITCH,
    ALWAYS,
  ];
}
