import { Sidebar } from '@/components/layout/sidebar';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/layout/sign-out-button';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-600">{user?.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-neutral-50 p-6">{children}</main>
      </div>
    </div>
  );
}