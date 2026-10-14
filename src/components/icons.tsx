/**
 * Inline SVG icons (no icon library dependency).
 * All use currentColor so they inherit the button's text color.
 */

import type { ComponentChildren, JSX } from "preact";

interface IconProps {
  size?: number;
}

function Svg({
  size = 17,
  children,
  ...rest
}: IconProps & JSX.SVGAttributes<SVGSVGElement> & { children?: ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconNew = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconAdd = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconPdf = () => (
  <Svg>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M9 15h6M9 11h2" />
  </Svg>
);

export const IconPrint = () => (
  <Svg>
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </Svg>
);

export const IconGear = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

export const IconTrash = () => (
  <Svg>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
  </Svg>
);

export const IconDrag = () => (
  <Svg>
    <circle cx="9" cy="6" r="1.6" fill="currentColor" />
    <circle cx="15" cy="6" r="1.6" fill="currentColor" />
    <circle cx="9" cy="12" r="1.6" fill="currentColor" />
    <circle cx="15" cy="12" r="1.6" fill="currentColor" />
    <circle cx="9" cy="18" r="1.6" fill="currentColor" />
    <circle cx="15" cy="18" r="1.6" fill="currentColor" />
  </Svg>
);

export const IconUndo = () => (
  <Svg>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
);

export const IconRedo = () => (
  <Svg>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Svg>
);

export const IconClose = () => (
  <Svg>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const IconZoomIn = () => (
  <Svg>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35M11 8v6M8 11h6" />
  </Svg>
);

export const IconZoomOut = () => (
  <Svg>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35M8 11h6" />
  </Svg>
);

export const IconFit = () => (
  <Svg>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const IconWhatsapp = () => (
  <Svg>
    <path d="M20.5 11.5a8.5 8.5 0 0 1-12 8L4 21l1.6-4.6a8.5 8.5 0 1 1 14.9-4.9z" />
    <path d="M9.5 8.2c-.3 0-.6 0-.8.4l-.9 1.7c-.2.4-.1.9.2 1.3 1 1.3 2.3 2.6 3.6 3.6.4.3.9.4 1.3.2l1.7-.9c.4-.2.4-.5.4-.8 0-.2 0-.4-.2-.6l-1.2-1.5a.7.7 0 0 0-.9-.2l-1 .5a6.5 6.5 0 0 1-2.3-2.3l.5-1a.7.7 0 0 0-.2-.9L10.2 8.4c-.2-.2-.4-.2-.7-.2z" />
  </Svg>
);
