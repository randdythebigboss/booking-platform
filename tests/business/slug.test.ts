import { describe, expect, it } from 'vitest';

import { isValidSlug, slugify, validateSlug } from '@/features/business/slug';

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Demo Studio')).toBe('demo-studio');
  });

  it('transliterates Spanish accents instead of dropping them', () => {
    expect(slugify('Peluquería Ñoño')).toBe('peluqueria-nono');
    expect(slugify('Salón Bélgica')).toBe('salon-belgica');
  });

  it('collapses punctuation and runs of separators', () => {
    expect(slugify('Alex & Co.   Barbers!!')).toBe('alex-co-barbers');
  });

  it('does not leave a leading or trailing dash', () => {
    expect(slugify('  --Studio--  ')).toBe('studio');
  });

  it('truncates without leaving a dangling dash', () => {
    const slug = slugify('a'.repeat(58) + ' bb');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('produces something the database will accept', () => {
    expect(isValidSlug(slugify('Estética Móvil 24/7'))).toBe(true);
  });
});

describe('validateSlug', () => {
  it('accepts a well-formed slug', () => {
    expect(validateSlug('demo-studio')).toBeUndefined();
  });

  it('rejects the shapes the database regex would reject', () => {
    expect(validateSlug('')?.code).toBe('slug.required');
    expect(validateSlug('ab')).toEqual({ code: 'slug.tooShort', values: { min: 3 } });
    expect(validateSlug('Demo-Studio')?.code).toBe('slug.invalid');
    expect(validateSlug('demo--studio')?.code).toBe('slug.invalid');
    expect(validateSlug('-demo')?.code).toBe('slug.invalid');
    expect(validateSlug('demo_studio')?.code).toBe('slug.invalid');
    expect(validateSlug('a'.repeat(61))).toEqual({ code: 'slug.tooLong', values: { max: 60 } });
  });
});
