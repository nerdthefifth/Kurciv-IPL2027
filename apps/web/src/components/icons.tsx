import type { SVGProps } from 'react';

/** Original 24px stroke icons (no icon font, no external dependency). */
const P: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5',
  squad: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 20c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M13 15.4c1-.3 2-.4 3-.4 2.7 0 4.9 1.7 5.5 5',
  tactics: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3.5v-1',
  match: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 4.2c2 2.3 2.5 5.4 1.6 8.3-.7 2.4-2.6 4.5-5 5.5m13.8-12c-2 2.3-2.5 5.4-1.6 8.3.7 2.4 2.6 4.5 5 5.5',
  calendar: 'M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4',
  league: 'M5 20V10m7 10V4m7 16v-7',
  gavel: 'm14 5 5 5m-8.5-1.5 5 5M9 7l6-3 5 5-3 6-8-8Zm1.5 4.5L3.5 18.5l2 2 7-7M14 21h7',
  transfer: 'M4 8h13l-3.5-3.5M20 16H7l3.5 3.5',
  scout: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5',
  youth: 'M12 21v-8m0 0c0-4 3-6 7-6 0 4-3 6-7 6Zm0 0c0-3-2.4-5-6-5 0 3 2.4 5 6 5',
  training: 'M6.5 7v10M17.5 7v10M3.5 10v4M20.5 10v4M6.5 12h11',
  medical: 'M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z',
  finance: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3-12.5c-.5-1-1.6-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3.2 6 1.6 6 4.8 0 1.3-1.3 2.3-3 2.3-1.5 0-2.7-.6-3.2-1.7M12 5.5v2m0 9.5v1.5',
  world: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H4.5c0 2.7 1.4 4.2 3.8 4.6M16 6h3.5c0 2.7-1.4 4.2-3.8 4.6M12 13v4m-4 3.5h8M9.5 17h5',
  history: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4v4.6h4.6M12 8v4.5l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.5 7.5 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7.4 7.4 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1c.7.6 1.4 1 2.2 1.3l.4 2.4h4l.3-2.4c.8-.3 1.6-.7 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  inbox: 'M3.5 13.5 6 5h12l2.5 8.5V19h-17v-5.5Zm0 0H8l1.5 2.5h5L16 13.5h4.5',
  chat: 'M4 5h16v11H9l-5 4V5Zm4 4.5h8m-8 3h5',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 4h3v8a2 2 0 0 1-2 2M7.5 8.5h6m-6 3.5h6m-6 3.5h4',
  feed: 'M5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm-1-7a8 8 0 0 1 8 8M4 5a15 15 0 0 1 15 15',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2ZM10 20.5h4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  check: 'M5 12.5 10 17l9-10',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v4.5m0 2.5v.5',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14',
  upload: 'M12 20V9m0 0-4.5 4.5M12 9l4.5 4.5M5 4h14',
  copy: 'M8.5 8.5h11v11h-11zM5 15.5H4.5v-11h11V5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6m4-6v6',
  pause: 'M8 5v14m8-14v14',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  fast: 'M4 6v12l8-6-8-6Zm8 0v12l8-6-8-6Z',
  star: 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9v.5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7m-10 10-1.4 1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  plus: 'M12 5v14M5 12h14',
  bat: 'M15.5 3.5 20.5 8.5 9 20l-5-5L15.5 3.5ZM4 15l-1.5 1.5L7.5 21.5 9 20M14 5l5 5',
  ball: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-5-12.5c2.5 1 3.5 3 3.5 4.5s-1 3.5-3.5 4.5m10-9c-2.5 1-3.5 3-3.5 4.5s1 3.5 3.5 4.5',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
  book: 'M5 4.5h10a4 4 0 0 1 4 4V20H9a4 4 0 0 1-4-4V4.5ZM5 16a4 4 0 0 1 4-4h10',
  shield: 'M12 3.5 19.5 6v6c0 4.4-3.1 7.6-7.5 8.5-4.4-.9-7.5-4.1-7.5-8.5V6L12 3.5Z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className = '', title, ...rest }: { name: IconName; size?: number; className?: string; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} {...rest}>
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}
