export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup">
      <svg viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <path
          d="M34 5H16C8.82 5 3 10.82 3 18v3h23a5 5 0 0 1 0 10H12L5 39h21c9.39 0 17-7.61 17-17v-3H17a3 3 0 0 1 0-6h10l7-8Z"
          fill="currentColor"
        />
        <path d="m34 5-7 8h10l6-8h-9Z" fill="#468ffa" />
      </svg>
      {!compact && (
        <span>
          Salute<span className="brand-pay">Pay</span>
        </span>
      )}
    </span>
  );
}
export function ChainLogo({
  chain,
  size = 28,
}: {
  chain: string;
  size?: number;
}) {
  return (
    <img
      className="network-logo"
      src={`/brand/${chain}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
