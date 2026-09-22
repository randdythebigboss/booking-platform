-- ===========================================================================
-- An appointment's customer and professional must belong to its own business.
--
-- Nothing enforced this. The plain foreign keys only require the rows to
-- exist, and Row Level Security checks `business_id` on the appointment --
-- not that the customer or professional hanging off it come from the same
-- tenant. A member could therefore point one of their own appointments at
-- another business's customer, given a uuid they should never have.
--
-- In practice they cannot read foreign ids, so this is an integrity hole
-- rather than a live leak. It is still the kind of invariant that belongs in
-- the schema: it guards against our own bugs as much as against anyone.
--
-- Composite foreign keys say it declaratively, which is better than a trigger
-- because the planner enforces it on every path including COPY.
-- ===========================================================================

alter table public.customers
  add constraint customers_id_business_key unique (id, business_id);

alter table public.professional_profiles
  add constraint professional_profiles_id_business_key unique (id, business_id);

alter table public.appointments
  add constraint appointments_customer_same_business
  foreign key (customer_id, business_id)
  references public.customers (id, business_id)
  on delete restrict;

alter table public.appointments
  add constraint appointments_professional_same_business
  foreign key (professional_id, business_id)
  references public.professional_profiles (id, business_id)
  on delete restrict;

-- The same reasoning one level down: a service may only be offered by a
-- professional of the business that owns it.
alter table public.services
  add constraint services_id_business_key unique (id, business_id);

-- ---------------------------------------------------------------------------
-- Drop the single-column keys these replace.
--
-- The composite key is strictly stronger -- it implies the simple one -- so
-- keeping both is redundant. It is also actively harmful: PostgREST resolves
-- embedded reads by walking foreign keys, and two paths between the same pair
-- of tables makes `appointments?select=...,customers(...)` ambiguous
-- (PGRST201). One key, one relationship, one meaning.
-- ---------------------------------------------------------------------------

alter table public.appointments drop constraint appointments_customer_id_fkey;
alter table public.appointments drop constraint appointments_professional_id_fkey;
