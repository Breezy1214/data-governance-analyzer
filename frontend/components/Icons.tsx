const PATHS = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  describe: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  questions: "M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2",
  assessment: "M12 3a9 9 0 1 0 9 9h-9z M15 3.5A9 9 0 0 1 20.5 9H15z",
  recommendations: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  register: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  plus: "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg aria-hidden="true" width="34" height="34" viewBox="0 0 34 34" fill="none" className="brand-mark">
      <path d="M17 2.5l12 4.6v8.4c0 7.4-5 13.5-12 16-7-2.5-12-8.6-12-16V7.1z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11h6a5 5 0 0 1 0 10h-6zM12 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
