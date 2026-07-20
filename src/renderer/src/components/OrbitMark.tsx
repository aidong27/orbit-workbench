import clsx from 'clsx';

export function OrbitMark({ size = 28, active = false }: { size?: number; active?: boolean }) {
  return (
    <span
      className={clsx('orbit-mark', active && 'orbit-mark--active')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle className="orbit-mark__ring" cx="16" cy="16" r="9.4" />
        <path className="orbit-mark__slash" d="M9.2 22.8 22.8 9.2" />
        <circle className="orbit-mark__star" cx="23.4" cy="8.6" r="2.2" />
      </svg>
    </span>
  );
}
