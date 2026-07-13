'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function addFinanceEntry(entry: {
  entry_type: 'income' | 'expense';
  category: string;
  amount: number;
  currency: string;
  description?: string;
  occurred_on: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('finance_entries').insert({ user_id: user.id, ...entry });
  if (error) throw new Error(error.message);
  revalidatePath('/finance');
}

export async function deleteFinanceEntry(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('finance_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/finance');
}