import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';

import type { PaymentRequirement } from '@/features/payments';

export interface AdminService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number;
  paymentRequirement: PaymentRequirement;
  /** Exact decimal from the database, or null when nothing is asked for. */
  depositAmount: string | null;
  currency: string;
  isActive: boolean;
}

export async function fetchServices(businessId: string): Promise<AdminService[]> {
  const { data, error } = await getSupabase()
    .from('services')
    .select(
      'id, name, description, duration_minutes, buffer_before_minutes,' +
        ' buffer_after_minutes, price, currency, is_active, sort_order,' +
        ' payment_requirement, deposit_amount',
    )
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw toWorkspaceError(error);

  return (data ?? []).map((row: Record<string, any>) => ({
    id: String(row.id),
    name: String(row.name),
    description: row.description ?? null,
    durationMinutes: Number(row.duration_minutes),
    bufferBeforeMinutes: Number(row.buffer_before_minutes),
    bufferAfterMinutes: Number(row.buffer_after_minutes),
    price: Number(row.price),
    paymentRequirement: (row.payment_requirement ?? 'none') as PaymentRequirement,
    depositAmount: row.deposit_amount == null ? null : String(row.deposit_amount),
    currency: String(row.currency),
    isActive: Boolean(row.is_active),
  }));
}

export interface SaveServiceInput {
  businessId: string;
  serviceId?: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number;
  isActive: boolean;
  paymentRequirement?: PaymentRequirement;
  /** Only meaningful when the requirement is a deposit. */
  depositAmount?: number | null;
}

/**
 * Saves a service and keeps it assigned to the business's professionals, in
 * one transaction. A service nobody offers is invisible on the booking page.
 */
export async function saveService(input: SaveServiceInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('save_service', {
    p_business_id: input.businessId,
    p_name: input.name,
    p_duration_minutes: input.durationMinutes,
    p_price: input.price,
    p_payment_requirement: input.paymentRequirement ?? 'none',
    p_deposit_amount: input.depositAmount ?? null,
    p_service_id: input.serviceId ?? null,
    p_description: input.description ?? null,
    p_buffer_before_minutes: input.bufferBeforeMinutes,
    p_buffer_after_minutes: input.bufferAfterMinutes,
    p_is_active: input.isActive,
  });

  if (error) throw toWorkspaceError(error);
  return String(data);
}

/**
 * Services are deactivated, not deleted: past appointments reference them,
 * and their snapshots should keep pointing at something real.
 */
export async function deactivateService(serviceId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('services')
    .update({ is_active: false })
    .eq('id', serviceId);

  if (error) throw toWorkspaceError(error);
}
