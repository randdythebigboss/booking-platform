import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import type { BusinessMemberRole } from '@/types/domain';

export interface WorkspaceBusiness {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  autoConfirmBookings: boolean;
  isPublished: boolean;
}

export interface WorkspaceProfessional {
  id: string;
  displayName: string;
  bio: string | null;
  isBookable: boolean;
}

export interface Workspace {
  business: WorkspaceBusiness;
  professional: WorkspaceProfessional | null;
  role: BusinessMemberRole;
}

const BUSINESS_COLUMNS =
  'id, name, slug, description, timezone, phone, email, address, currency,' +
  ' slot_interval_minutes, minimum_notice_minutes, booking_horizon_days,' +
  ' auto_confirm_bookings, is_published';

function toBusiness(row: Record<string, unknown>): WorkspaceBusiness {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    timezone: String(row.timezone),
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    currency: String(row.currency),
    slotIntervalMinutes: Number(row.slot_interval_minutes),
    minimumNoticeMinutes: Number(row.minimum_notice_minutes),
    bookingHorizonDays: Number(row.booking_horizon_days),
    autoConfirmBookings: Boolean(row.auto_confirm_bookings),
    isPublished: Boolean(row.is_published),
  };
}

/**
 * The business this professional is working on.
 *
 * Multi-tenancy is in the schema from day one, but the MVP interface shows
 * one business at a time: the oldest membership wins until there is a
 * switcher to justify anything cleverer.
 */
export async function fetchWorkspace(userId: string): Promise<Workspace | null> {
  const supabase = getSupabase();

  const { data: membership, error: membershipError } = await supabase
    .from('business_members')
    .select(`role, business_id, businesses ( ${BUSINESS_COLUMNS} )`)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) throw toWorkspaceError(membershipError);
  if (!membership) return null;

  const row = membership as Record<string, any>;
  const businessRow = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
  if (!businessRow) return null;

  const { data: professionalRow, error: professionalError } = await supabase
    .from('professional_profiles')
    .select('id, display_name, bio, is_bookable')
    .eq('business_id', row.business_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (professionalError) throw toWorkspaceError(professionalError);

  return {
    business: toBusiness(businessRow),
    professional: professionalRow
      ? {
          id: String(professionalRow.id),
          displayName: String(professionalRow.display_name),
          bio: (professionalRow.bio as string | null) ?? null,
          isBookable: Boolean(professionalRow.is_bookable),
        }
      : null,
    role: row.role as BusinessMemberRole,
  };
}

export interface CreateBusinessInput {
  name: string;
  slug: string;
  timezone: string;
  displayName: string;
}

/** One transaction: business, membership and professional profile together. */
export async function createBusiness(
  input: CreateBusinessInput,
): Promise<{ businessId: string; professionalId: string }> {
  const { data, error } = await getSupabase().rpc('create_business', {
    p_name: input.name,
    p_slug: input.slug,
    p_timezone: input.timezone,
    p_display_name: input.displayName,
  });

  if (error) throw toWorkspaceError(error);

  const result = data as Record<string, unknown>;
  return {
    businessId: String(result.businessId),
    professionalId: String(result.professionalId),
  };
}

export type BusinessPatch = Partial<{
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  autoConfirmBookings: boolean;
  isPublished: boolean;
}>;

const BUSINESS_COLUMN_NAMES: Record<keyof BusinessPatch, string> = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  timezone: 'timezone',
  phone: 'phone',
  email: 'email',
  address: 'address',
  slotIntervalMinutes: 'slot_interval_minutes',
  minimumNoticeMinutes: 'minimum_notice_minutes',
  bookingHorizonDays: 'booking_horizon_days',
  autoConfirmBookings: 'auto_confirm_bookings',
  isPublished: 'is_published',
};

export async function updateBusiness(businessId: string, patch: BusinessPatch): Promise<void> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = BUSINESS_COLUMN_NAMES[key as keyof BusinessPatch];
    if (column) row[column] = value;
  }

  if (Object.keys(row).length === 0) return;

  const { error } = await getSupabase().from('businesses').update(row).eq('id', businessId);
  if (error) throw toWorkspaceError(error);
}

export async function updateProfessional(
  professionalId: string,
  patch: { displayName?: string; bio?: string | null; isBookable?: boolean },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.bio !== undefined) row.bio = patch.bio;
  if (patch.isBookable !== undefined) row.is_bookable = patch.isBookable;

  if (Object.keys(row).length === 0) return;

  const { error } = await getSupabase()
    .from('professional_profiles')
    .update(row)
    .eq('id', professionalId);

  if (error) throw toWorkspaceError(error);
}
