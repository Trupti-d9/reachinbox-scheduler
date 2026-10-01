import clsx from 'clsx';

export function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const style = { width: size, height: size };
  return src ? (
    <img src={src} alt={name} style={style} referrerPolicy="no-referrer" className="rounded-full object-cover ring-2 ring-white" />
  ) : (
    <span
      style={style}
      className={clsx('inline-flex items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white ring-2 ring-white')}
    >
      {initials || '?'}
    </span>
  );
}
