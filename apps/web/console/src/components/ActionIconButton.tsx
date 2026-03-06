import type { ButtonHTMLAttributes } from "react";

type IconName = "probe" | "edit" | "delete" | "spinner";
type Tone = "ghost" | "primary" | "danger";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
  tone?: Tone;
  busy?: boolean;
};

function ActionIcon({ icon }: { icon: IconName }) {
  switch (icon) {
    case "probe":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M4 9a11 11 0 0 1 16 0M7 12a7 7 0 0 1 10 0M10.5 15.5a2.2 2.2 0 0 1 3 0M12 18h.01"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "edit":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M4 20h4l10-10a2.1 2.1 0 1 0-3-3L5 17v3Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "delete":
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M5 7h14M9 7V5h6v2m-7 3v7m4-7v7m4-7v7M7 7l1 12h8l1-12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 3a9 9 0 1 0 9 9"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
  }
}

export function ActionIconButton({
  icon,
  label,
  tone = "ghost",
  busy = false,
  className,
  ...props
}: Props) {
  return (
    <button
      aria-label={label}
      className={["icon-button", tone, busy ? "is-busy" : "", className].filter(Boolean).join(" ")}
      title={label}
      {...props}
    >
      <ActionIcon icon={busy ? "spinner" : icon} />
    </button>
  );
}
