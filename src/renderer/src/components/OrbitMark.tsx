import clsx from 'clsx';

export function OrbitMark({ size = 28, active = false }: { size?: number; active?: boolean }) {
  return (
    <span
      className={clsx('orbit-mark', active && 'orbit-mark--active')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <g className="orbit-mark__system">
          <ellipse cx="16" cy="16" rx="10.7" ry="4.9" transform="rotate(-18 16 16)" />
          <ellipse cx="16" cy="16" rx="10.7" ry="4.9" transform="rotate(42 16 16)" />
          <ellipse cx="16" cy="16" rx="10.7" ry="4.9" transform="rotate(102 16 16)" />
          <circle className="orbit-mark__node orbit-mark__node--cyan" cx="24.6" cy="11.5" r="1.5" />
          <circle className="orbit-mark__node" cx="8.8" cy="20.2" r="1.2" />
        </g>
        <path
          className="orbit-mark__core"
          d="M16 11.8 17.1 14.9 20.2 16 17.1 17.1 16 20.2 14.9 17.1 11.8 16 14.9 14.9Z"
        />
      </svg>
    </span>
  );
}
