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
       professional_profiles ( id, display_name, bio, avatar_url, sort_order ),
       services ( id, name, description, duration_minutes, price, currency, sort_order )`,
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
        currency: s.currency,
      })),
  };
}
