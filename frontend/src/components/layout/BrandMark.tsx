interface BrandMarkProps {
  size?: number;
  className?: string;
}

// InfraPulse logo mark: a pulse/heartbeat line on a teal gradient tile.
export function BrandMark({ size = 32, className = "" }: BrandMarkProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 text-brand-900 shadow-lg shadow-primary-900/40 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 12h4l2.5-7 4 14 2.5-7H22" />
      </svg>
    </span>
  );
}
