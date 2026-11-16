// Inline SVG icons of the assistant widget. Drawn here (24px grid, 1.75 stroke, currentColor)
// instead of pulled from an icon library, so the widget stays self-contained and the launcher
// chunk only carries the two glyphs it renders. Every icon is decorative: the controls that use
// them carry their own accessible label.
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const BUBBLE = "M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7.25L7 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z";

/** Speech bubble with a small spark: "chat with an AI". */
export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d={BUBBLE} />
      <path
        d="M12 7.6l.95 2.5 2.5.95-2.5.95-.95 2.5-.95-2.5-2.5-.95 2.5-.95z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={0.75}
      />
    </Svg>
  );
}

/** Plain speech bubble, used for messaging-app links (WhatsApp). */
export function BubbleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d={BUBBLE} />
      <path d="M8 9.5h8M8 13h5" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5.5M6.5 11 12 5.5 17.5 11" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Pencil on a sheet: "new conversation". */
export function NewChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11.5 4.5H6a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h11.5a2 2 0 0 0 2-2v-5.5" />
      <path d="M17.4 3.6a2 2 0 0 1 2.9 2.9L13 13.8l-3.6.9.9-3.6z" />
    </Svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v13.5M6.5 13 12 18.5 17.5 13" />
    </Svg>
  );
}

/** A sheet with lines: "quote request". */
export function QuoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.75v5M12 16.25h.01" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </Svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 14.5 14.5 9.5M10.5 6.5l1.4-1.4a4 4 0 0 1 5.7 5.7l-1.4 1.4M13.5 17.5l-1.4 1.4a4 4 0 0 1-5.7-5.7l1.4-1.4" />
    </Svg>
  );
}
