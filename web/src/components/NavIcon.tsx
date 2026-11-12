import type { ReactNode } from "react";

export type NavIconName =
  | "ideas"
  | "studies"
  | "results"
  | "portfolio"
  | "system"
  | "research"
  | "overview"
  | "signals"
  | "sources"
  | "compare"
  | "lab"
  | "more";

// 24x24 outline glyphs drawn for this dashboard. They inherit the link colour.
const paths: Record<NavIconName, ReactNode> = {
  ideas: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  studies: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5.2 8.6A1.6 1.6 0 0 0 6.2 20h11.6a1.6 1.6 0 0 0 1.4-2.4L14 9V3" />
      <path d="M7.5 14h9" />
    </>
  ),
  results: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6" />
      <path d="M12 20V5" />
      <path d="M17 20v-9" />
    </>
  ),
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M3 13h18" />
    </>
  ),
  system: (
    <>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2.25" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M18.4 5.6l-2.2 2.2M7.8 16.2l-2.2 2.2" />
    </>
  ),
  research: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  overview: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  signals: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  sources: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  compare: (
    <>
      <path d="M4 8h14" />
      <path d="M15 5l3 3-3 3" />
      <path d="M20 16H6" />
      <path d="M9 13l-3 3 3 3" />
    </>
  ),
  lab: (
    <>
      <path d="M8 3h8" />
      <path d="M9.5 3v14a2.5 2.5 0 0 0 5 0V3" />
      <path d="M9.5 12h5" />
    </>
  ),
  more: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
};

export default function NavIcon({ name, className = "w-5 h-5" }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
