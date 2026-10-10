/** Inline SVG icons (offline, no icon font). File-type icons follow the colour convention:
 *  spreadsheet/CSV green, PDF red, Word blue, JSON ink. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18, rest: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest,
});

export const IconSettings = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
export const IconFullscreen = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
);
export const IconExitFullscreen = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
);
export const IconClose = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M18 6 6 18M6 6l12 12" /></svg>);
export const IconUpload = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>);
export const IconDownload = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>);
export const IconPrint = ({ size, ...r }: P) => (
  <svg {...base(size, r)}><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>
);
export const IconTrash = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>);
export const IconEdit = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" /></svg>);
export const IconPlus = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconUp = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="m18 15-6-6-6 6" /></svg>);
export const IconDown = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="m6 9 6 6 6-6" /></svg>);
export const IconPlay = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="m6 4 14 8-14 8z" /></svg>);
export const IconStop = ({ size, ...r }: P) => (<svg {...base(size, r)}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>);
export const IconRestore = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>);
export const IconCheck = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M20 6 9 17l-5-5" /></svg>);
export const IconAlert = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>);
export const IconWifi = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01" /></svg>);
export const IconWifiOff = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M2 2l20 20M8.5 16.1a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 5.2-2.8M19 12.6a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5M12 20h.01" /></svg>);
export const IconEye = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>);
export const IconLock = ({ size, ...r }: P) => (<svg {...base(size, r)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>);
export const IconSun = ({ size, ...r }: P) => (<svg {...base(size, r)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>);
export const IconMoon = ({ size, ...r }: P) => (<svg {...base(size, r)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>);
export const IconClock = ({ size, ...r }: P) => (<svg {...base(size, r)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);

/** Spreadsheet / CSV — green */
export const IconFileCsv = ({ size = 18, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...r}>
    <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#1D6F42" />
    <path d="M14 2v5h5" fill="#4CA36B" />
    <path d="M8 11l4 6M12 11l-4 6M14 11v6h3" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
  </svg>
);
/** JSON — ink */
export const IconFileJson = ({ size = 18, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...r}>
    <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#334E68" />
    <path d="M14 2v5h5" fill="#627D98" />
    <path d="M9.5 11c-1 0-1 .8-1 1.5s-.4 1.5-1 1.5c.6 0 1 .8 1 1.5s0 1.5 1 1.5M14.5 11c1 0 1 .8 1 1.5s.4 1.5 1 1.5c-.6 0-1 .8-1 1.5s0 1.5-1 1.5" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </svg>
);
/** PDF — red */
export const IconFilePdf = ({ size = 18, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...r}>
    <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#D93025" />
    <path d="M14 2v5h5" fill="#F28B82" />
    <text x="12" y="17.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="Arial">PDF</text>
  </svg>
);

/** Brand mark: arch + crescent */
export const BrandMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <rect width="64" height="64" rx="16" fill="#0B3D30" />
    <path d="M18 50V30c0-8 6-14 14-18 8 4 14 10 14 18v20z" fill="none" stroke="#D4AF61" strokeWidth="3.5" strokeLinejoin="round" />
    <path d="M36 25a7 7 0 1 1-5-9 5.5 5.5 0 0 0 5 9z" fill="#F1DFA8" />
    <path d="M26 50V40a6 6 0 0 1 12 0v10" fill="none" stroke="#D4AF61" strokeWidth="3" />
  </svg>
);
