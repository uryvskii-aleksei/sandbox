import type { SVGProps } from 'react';

export type IconName =
  | 'pencil'
  | 'trash'
  | 'board'
  | 'list'
  | 'settings'
  | 'link'
  | 'linkSource'
  | 'linkTarget'
  | 'close'
  | 'record'
  | 'folder'
  | 'text'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'keyboard'
  | 'search'
  | 'sidebar'
  | 'copy'
  | 'paste'
  | 'plus';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, string> = {
  pencil: 'm16 4 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  board: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  settings:
    'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  linkSource: 'M9 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm0 0h12m-3-3 3 3-3 3',
  linkTarget: 'M21 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM3 12h12M6 9l-3 3 3 3',
  close: 'm6 6 12 12M6 18 18 6',
  record: 'M5 3h9l5 5v13H5ZM14 3v5h5M8 12h8M8 16h8',
  folder: 'M3 5h6l2 3h10v11H3Z',
  text: 'M4 6V4h16v2M12 4v16M8 20h8',
  line: 'M4 20 20 4',
  rectangle: 'M3 6h18v12H3Z',
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  keyboard: 'M2 5h20v14H2ZM6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M8 16h8',
  search: 'M20 20l-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  sidebar: 'M3 5h18v14H3ZM9 5v14',
  copy: 'M8 8h12v12H8ZM16 8V4H4v12h4',
  paste: 'M8 5H5v16h14V5h-3M8 3h8v5H8ZM9 12h6M9 16h6',
  plus: 'M12 5v14M5 12h14',
};

export function Icon({ name, size = 18, className = '', ...props }: IconProps) {
  return (
    <svg
      {...props}
      className={`ui-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
