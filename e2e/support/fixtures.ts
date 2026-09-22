/**
 * What the seed and the E2E fixture put in the database, named once.
 *
 * Every identifier here is fixed in supabase/seed.sql or
 * supabase/fixtures/e2e.sql. A test that had to discover them first would fail
 * for reasons nobody could read.
 *
 * Everything is fictional: reserved test domains, telephone numbers in the 555
 * range, invented people.
 */

export const TENANT_A = {
  slug: 'demo-studio',
  name: 'Estudio Demo',
  email: 'demo@bookingplatform.test',
  password: 'demo-password-123',
  professional: 'Alex Rivera',
  timezone: 'America/Santo_Domingo',
  services: {
    free: 'Corte de cabello',
    deposit: 'Color y tratamiento',
    full: 'Taller privado',
  },
} as const;

export const TENANT_B = {
  slug: 'salon-brisa',
  name: 'Salón Brisa',
  email: 'owner@salon-brisa.test',
  password: 'brisa-password-123',
  professional: 'Paula Moreno',
  services: { free: 'Corte sencillo' },
  /** A confirmed appointment that belongs to tenant B and to nobody else. */
  appointment: {
    id: 'bbbbbbbb-6666-4666-8666-000000000001',
    token: 'bbbbbbbb-7777-4777-8777-000000000001',
    customer: 'Marta Duarte',
  },
} as const;

/** A guest nobody has to worry about. */
export const GUEST = {
  name: 'Lucía Prueba',
  phone: '+1 809 555 0111',
  email: 'lucia@example.test',
} as const;
