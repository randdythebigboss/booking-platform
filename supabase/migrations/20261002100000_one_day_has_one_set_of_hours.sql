-- ===========================================================================
-- One day has one set of hours.
--
-- ---------------------------------------------------------------------------
-- What went wrong
-- ---------------------------------------------------------------------------
--
-- The exceptions screen says, in its own words, that "custom hours replace
-- that day's normal hours entirely". Saving twice for the same date did not
-- replace anything: it inserted a second row. The professional saw two
-- contradictory entries for one Wednesday, and -- worse -- `working_windows`
-- returned both of them.
--
-- So a professional who changed Wednesday from 11:00-15:00 to 13:00-15:00 was
-- still open at 11:00. They had no way to see that from the screen they had
-- just used, and the first they would learn of it is a customer arriving at a
-- time they thought they had closed.
--
-- ---------------------------------------------------------------------------
-- Why an index rather than only fixing the caller
-- ---------------------------------------------------------------------------
--
-- The caller is being fixed too. But "the client remembers to replace" is not
-- a guarantee, and this is a rule about what the data is allowed to mean: a
-- date cannot have two different sets of custom hours, in the same way it
-- cannot be both open and closed. Rules about what the data means belong to
-- the database, where a second client, a retry or a race cannot get around
-- them.
--
-- ---------------------------------------------------------------------------
-- What is deliberately still allowed
-- ---------------------------------------------------------------------------
--
-- Several *timed* closures on one date -- "shut 10:00-11:00 and again
-- 14:00-15:00". Those are additive rather than contradictory, the seed itself
-- uses one, and the product offers Blocks for the same shape. Only the two
-- kinds that can contradict each other are constrained:
--
--   * one set of custom hours per date
--   * one whole-day closure per date
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Existing duplicates, if any. Newest wins: it is what the professional most
-- recently asked for, and it is the one the screen was showing them as the
-- result of their last save.
-- ---------------------------------------------------------------------------

delete from public.availability_exceptions e
using public.availability_exceptions keep
where e.professional_id = keep.professional_id
  and e.exception_date = keep.exception_date
  and e.exception_type = 'available'
  and keep.exception_type = 'available'
  and (e.created_at, e.id) < (keep.created_at, keep.id);

delete from public.availability_exceptions e
using public.availability_exceptions keep
where e.professional_id = keep.professional_id
  and e.exception_date = keep.exception_date
  and e.exception_type = 'unavailable'
  and keep.exception_type = 'unavailable'
  and e.start_time is null
  and keep.start_time is null
  and (e.created_at, e.id) < (keep.created_at, keep.id);

-- ---------------------------------------------------------------------------
-- The guarantees
-- ---------------------------------------------------------------------------

create unique index if not exists availability_exceptions_one_custom_day
  on public.availability_exceptions (professional_id, exception_date)
  where exception_type = 'available';

create unique index if not exists availability_exceptions_one_closure_day
  on public.availability_exceptions (professional_id, exception_date)
  where exception_type = 'unavailable' and start_time is null;

comment on index public.availability_exceptions_one_custom_day is
  'A date may have at most one set of custom hours. Two would contradict each other and working_windows would return both.';

comment on index public.availability_exceptions_one_closure_day is
  'A date may be closed all day at most once. Timed closures are additive and stay unconstrained.';
