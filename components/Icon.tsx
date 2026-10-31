// Ícones de linha simples usados na tela de conversas.
const PATHS: Record<string, string> = {
  chat: "M4 5h16v11H9l-5 4z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  hourglass: "M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c2.4.6 4 2.3 4 5.2",
  bot: "M12 3v3M5 8h14v10H5zM9 13h.01M15 13h.01M2 12v3M22 12v3",
  team: "M7 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 20c0-3 3-5 6-5 1.6 0 3 .5 4 1.4M23 20c0-3-3-5-6-5-1.6 0-3 .5-4 1.4",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  filter: "M3 6h18M6 12h12M10 18h4",
  plus: "M12 5v14M5 12h14",
  panel: "M4 4h16v16H4zM9 4v16",
  building: "M4 21V4h10v17M14 9h6v12M7 8h4M7 12h4M7 16h4M2 21h20",
  chevron: "M6 9l6 6 6-6",
  columns: "M3 4h5v16H3zM10 4h4v16h-4zM16 4h5v16h-5z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  funnel: "M3 4h18l-7 8v6l-4 2v-8z",
  doc: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h6",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  logout: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  close: "M6 6l12 12M18 6L6 18",
  retry: "M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="icon"
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
