import type { SVGProps } from "react";

// One stroke family for the genome dashboard; all icons are decorative.
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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

export const ArrowUpRight = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);

export const ChevronDown = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const Check = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);

export const Search = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const Mic = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

export const Heart = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </Icon>
);

export const Spark = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </Icon>
);

/** Grade ring glyphs: clear ✓, carrier |, likely !. */
export const StatusGlyph = ({
  status,
}: {
  status: "likely" | "carrier" | "clear";
}) => (
  <Icon width="12" height="12" strokeWidth="2">
    {status === "clear" && <path d="m5 12 5 5 9-10" />}
    {status === "carrier" && <path d="M12 5v14" />}
    {status === "likely" && <path d="M12 6v7M12 17.5v.5" />}
  </Icon>
);
