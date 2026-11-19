import type { ReactNode, SVGProps } from "react";

export type SalonIconName = "calendar" | "sparkles" | "users" | "staff" | "bed" | "wallet" | "chart" | "settings" | "clock" | "plus" | "search" | "refresh" | "chevron-left" | "chevron-right" | "menu" | "arrow-up-right" | "check" | "logout" | "globe" | "grid" | "bell" | "phone" | "copy" | "close" | "filter" | "sun" | "shield" | "list" | "info";

const paths: Record<SalonIconName, ReactNode> = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3"/></>,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17ZM5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17Z"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/></>,
  staff: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2M9 13l3 3 3-3"/></>,
  bed: <><path d="M3 19V7M21 19V7M3 16h18M5 13V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M5 13h14"/></>,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M17 11h5v5h-5a2.5 2.5 0 0 1 0-5ZM3 9h13"/></>,
  chart: <><path d="M4 20V11M10 20V5M16 20v-8M22 20V3M2 21h21"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m4 12 2-1 .6-2L5 7l2-2 2 1.6 2-.6 1-2h2l1 2 2 .6L19 5l2 2-1.6 2 .6 2 2 1v2l-2 1-.6 2L21 19l-2 2-2-1.6-2 .6-1 2h-2l-1-2-2-.6L7 21l-2-2 1.6-2-.6-2-2-1v-2Z"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></>,
  "chevron-left": <path d="m15 18-6-6 6-6"/>,
  "chevron-right": <path d="m9 18 6-6-6-6"/>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  "arrow-up-right": <path d="M7 17 17 7M8 7h9v9"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-6 6-6 12 0 18M12 3c6 6 6 12 0 18"/></>,
  grid: <><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  phone: <path d="M4 4c0 9 7 16 16 16l2-4-5-3-3 3a13 13 0 0 1-6-6l3-3-3-5-4 2Z"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
  close: <path d="M5 5l14 14M19 5 5 19"/>,
  filter: <><path d="M3 5h18M6 12h12M10 19h4"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M20 4l-2 2M6 18l-2 2"/></>,
  shield: <><path d="m12 2 9 4v6c0 5-4 8-9 10-5-2-9-5-9-10V6l9-4Z"/><path d="m8 12 3 3 5-6"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
};

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: SalonIconName; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
