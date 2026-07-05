interface BrandMarkProps {
  size?: number;
  className?: string;
}

// NetVerse AI logo mark: a connected-node network (central hub + satellites)
// on a teal gradient tile — "network universe / infrastructure intelligence".
export function BrandMark({ size = 32, className = "" }: BrandMarkProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 text-brand-900 shadow-lg shadow-primary-900/40 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.64}
        height={size * 0.64}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* links from the central hub to the satellite nodes */}
        <line x1="12" y1="12" x2="12" y2="4.5" />
        <line x1="12" y1="12" x2="5.5" y2="18" />
        <line x1="12" y1="12" x2="18.5" y2="18" />
        {/* satellite nodes */}
        <circle cx="12" cy="4.5" r="2" fill="currentColor" stroke="none" />
        <circle cx="5.5" cy="18" r="2" fill="currentColor" stroke="none" />
        <circle cx="18.5" cy="18" r="2" fill="currentColor" stroke="none" />
        {/* central hub */}
        <circle cx="12" cy="12" r="2.7" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
