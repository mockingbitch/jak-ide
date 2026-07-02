import type { SVGProps } from 'react';

// Lightweight, dependency-free UI icons (JetBrains New UI / codicon flavour).
// All use `currentColor` so they inherit the button's text colour, and a 16px
// default box. File-type icons live in FileIcon.tsx (vscode-icons); these are
// the monochrome chrome icons for toolbars, activity bars and the status bar.

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
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
      aria-hidden="true"
      {...rest}
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      {children}
    </svg>
  );
}

export const IconProject = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.6-3.6" />
  </Svg>
);

export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.7.7v.1a2 2 0 1 1-4 0V18a1 1 0 0 0-1.7-.7l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0-.7-1.7H5a2 2 0 1 1 0-4h.1a1 1 0 0 0 .7-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.7-.7V5a2 2 0 1 1 4 0v.1a1 1 0 0 0 1.7.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.4 1.1" />
  </Svg>
);

export const IconAI = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5l1.6 4.2 4.4 1.6-4.4 1.6L12 15l-1.6-4.1L6 9.3l4.4-1.6z" />
    <path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Svg>
);

export const IconTerminal = (p: P) => (
  <Svg {...p}>
    <path d="m6 8 3.5 3.5L6 15" />
    <path d="M12.5 16h5.5" />
  </Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-.5 4" />
    <path d="M20 5v6h-6" />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IconFolderOpen = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H4" />
    <path d="M3.4 10h17.2l-2 7a1.5 1.5 0 0 1-1.4 1H4.6a1.5 1.5 0 0 1-1.4-1z" />
  </Svg>
);

export const IconArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V6M6 12l6-6 6 6" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);

export const IconBranch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="6" r="2.2" />
    <circle cx="7" cy="18" r="2.2" />
    <circle cx="17" cy="9" r="2.2" />
    <path d="M7 8.2v7.6M9.2 9H13a4 4 0 0 1 4 4v.8M17 11.2V11" />
  </Svg>
);

export const IconArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v13M6 12l6 6 6-6" />
  </Svg>
);

export const IconPencil = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L18 10l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);

export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </Svg>
);

export const IconSplit = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </Svg>
);

export const IconRun = (p: P) => (
  <Svg {...p}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPaperclip = (p: P) => (
  <Svg {...p}>
    <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8" />
  </Svg>
);

export const IconWarning = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 3 19h18z" />
    <path d="M12 10v4" />
    <path d="M12 16.5v.5" />
  </Svg>
);

export const IconHistory = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconAnnotate = (p: P) => (
  <Svg {...p}>
    <path d="M4 5v14" />
    <path d="M8 6.5h12M8 12h12M8 17.5h8" />
  </Svg>
);

export const IconWinMinimize = (p: P) => (
  <Svg {...p}>
    <path d="M5 19h14" />
  </Svg>
);

export const IconWinMaximize = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </Svg>
);

export const IconWinRestore = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="4" width="12" height="12" rx="1" />
    <path d="M4 8v11a1 1 0 0 0 1 1h11" />
  </Svg>
);

export const IconDocker = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 13c0-1.4 1.2-2.5 3-2.5h13c1.8 0 3 .9 3 2.2 0 3-3.3 5.3-9.3 5.3S2.5 15.5 2.5 13Z" />
    <rect x="5.5" y="8" width="3" height="3" />
    <rect x="9.5" y="8" width="3" height="3" />
    <rect x="9.5" y="4" width="3" height="3" />
    <rect x="13.5" y="8" width="3" height="3" />
  </Svg>
);

export const IconDatabase = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13" />
    <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
  </Svg>
);

export const IconLogs = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.5h.01" />
  </Svg>
);

export const IconAt = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" />
  </Svg>
);
