import type { PaymentRequirement } from '@/features/payments';
import { getSupabase } from '@/lib/supabase';

/** The public-facing shape of a business booking page. */
export interface PublicBusiness {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  currency: string;
  /** How far ahead this business lets people book. */
  bookingHorizonDays: number;
  professionals: PublicProfessional[];
  services: PublicService[];
}

export interface PublicProfessional {
  id: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  /** What has to be paid before this is booked, and how much of it. */
  paymentRequirement: PaymentRequirement;
  /** The exact decimal the database holds, or null when nothing is asked. */
  depositAmount: string | null;
  /** Both computed in SQL. Nothing here subtracts one from the other. */
  amountDueNow: string;
  amountDueLater: string;
  currency: string;
}

/**
 * Reads a published booking page. Row Level Security is what makes this safe
 * to call with the anon key: unpublished businesses simply do not exist as
 * far as this query is concerned.
 */
export async function fetchPublicBusiness(slug: string): Promise<PublicBusiness | null> {
  const { data, error } = await getSupabase()
    .from('businesses')
    .select(
      `id, name, slug, description, timezone, phone, address, logo_url, currency,
       booking_horizon_days,
       professional_profiles ( id, display_name, bio, avatar_url, sort_order ),
       services ( id, name, description, duration_minutes, price, currency, sort_order,
                  payment_requirement, deposit_amount, amount_due_now, amount_due_later )`,
    )
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Record<string, any>;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    timezone: row.timezone,
    phone: row.phone,
    address: row.address,
    logoUrl: row.logo_url,
    currency: row.currency,
    bookingHorizonDays: Number(row.booking_horizon_days ?? 60),
    professionals: (row.professional_profiles ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((p: any) => ({
        id: p.id,
        displayName: p.display_name,
        bio: p.bio,
        avatarUrl: p.avatar_url,
      })),
    services: (row.services ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMinutes: s.duration_minutes,
        price: Number(s.price),
        paymentRequirement: (s.payment_requirement ?? 'none') as PaymentRequirement,
        depositAmount: s.deposit_amount == null ? null : String(s.deposit_amount),
        amountDueNow: String(s.amount_due_now ?? '0'),
        amountDueLater: String(s.amount_due_later ?? s.price),
        currency: s.currency,
      })),
  };
}
