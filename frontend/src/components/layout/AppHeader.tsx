import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../ui';
import { useAuth } from '../../hooks/useAuth';

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-indigo-700 text-sm font-bold text-white shadow-sm">
        R
      </div>
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">
        ReachInbox <span className="font-normal text-slate-400">Scheduler</span>
      </span>
    </div>
  );
}

/** Top bar: logo on the left, user name/email/avatar with a logout menu on the right. */
export function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-2 transition-colors hover:bg-slate-100"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Avatar src={user.avatar_url} name={user.name} />
            <div className="hidden text-left sm:block">
              <p className="text-sm font-semibold leading-tight text-slate-800">{user.name}</p>
              <p className="text-xs leading-tight text-slate-500">{user.email}</p>
            </div>
            <ChevronDown className="size-4 text-slate-400" />
          </button>
          {open && (
            <div role="menu" className="animate-fade-in absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
              <div className="px-3 py-2 sm:hidden">
                <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="size-4" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
