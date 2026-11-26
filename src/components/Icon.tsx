import type { ReactNode, SVGProps } from "react";

type IconName =
  | "wind"
  | "search"
  | "pin"
  | "play"
  | "pause"
  | "plus"
  | "minus"
  | "compass"
  | "refresh"
  | "moon"
  | "sun"
  | "terrain"
  | "grid"
  | "menu"
  | "close";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

const paths: Record<IconName, ReactNode> = {
  wind: (
    <>
      <path d="M3 8h12.5a2.5 2.5 0 1 0-2.4-3.2" />
      <path d="M2 12h17a3 3 0 1 1-2.9 3.8" />
      <path d="M4 16h6.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  pause: (
    <>
      <path d="M8 5h3v14H8z" />
      <path d="M15 5h3v14h-3z" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4.7 9a7.5 7.5 0 0 1 12.6-2L20 12" />
      <path d="M4 17v-5h5" />
      <path d="M19.3 15a7.5 7.5 0 0 1-12.6 2L4 12" />
    </>
  ),
  moon: (
    <path d="M20.2 15.7A8.5 8.5 0 0 1 8.3 3.8 8.5 8.5 0 1 0 20.2 15.7Z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </>
  ),
  terrain: (
    <>
      <path d="m3 18 5-9 4 5 3-4 6 8H3Z" />
      <path d="m8 9 2-3 3 4m3 0 2-3 4 6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
      <path d="M9 3.5v17m6-17v17m-11.5-11h17m-17 6h17" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
};

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
