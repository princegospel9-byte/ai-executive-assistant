'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/email', label: 'Email Center' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/school-sales', label: 'School Sales' },
  { href: '/knowledge-base', label: 'Knowledge Base' },
  { href: '/reports', label: 'Reports' },
  { href: '/finance', label: 'Finance' },
  { href: '/support', label: 'Support' },
  { href: '/search', label: 'Search' },
  { href: '/job-tracker', label: 'Job Tracker' },
  { href: '/assistant', label: 'AI Advisor' },
  { href: '/agents', label: 'Agent Team' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-6 py-5">
        <p className="text-sm font-semibold text-neutral-900">KBrisks Executive AI</p>
        <p className="text-xs text-neutral-500">Foundation build</p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}