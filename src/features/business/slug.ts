/** Public link handling: `app.example.com/p/<slug>`. */

export const MIN_SLUG_LENGTH = 3;
export const MAX_SLUG_LENGTH = 60;

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Spelled out rather than using String.normalize, which is not dependable
// across every Hermes build the app has to run on.
const TRANSLITERATIONS: Record<string, string> = {
  á: 'a',
  à: 'a',
  ä: 'a',
  â: 'a',
  ã: 'a',
  å: 'a',
  é: 'e',
  è: 'e',
  ë: 'e',
  ê: 'e',
  í: 'i',
  ì: 'i',
  ï: 'i',
  î: 'i',
  ó: 'o',
  ò: 'o',
  ö: 'o',
  ô: 'o',
  õ: 'o',
  ú: 'u',
  ù: 'u',
  ü: 'u',
  û: 'u',
  ñ: 'n',
  ç: 'c',
  ß: 'ss',
};

/** Turns a business name into a candidate public link. */
export function slugify(name: string): string {
  const transliterated = name
    .toLowerCase()
    .split('')
    .map((character) => TRANSLITERATIONS[character] ?? character)
    .join('');

  return transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= MIN_SLUG_LENGTH && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)
  );
}

export function validateSlug(slug: string): string | undefined {
  if (slug.length === 0) return 'Choose a public link.';
  if (slug.length < MIN_SLUG_LENGTH) return `Use at least ${MIN_SLUG_LENGTH} characters.`;
  if (slug.length > MAX_SLUG_LENGTH) return `Use at most ${MAX_SLUG_LENGTH} characters.`;
  if (!SLUG_PATTERN.test(slug)) {
    return 'Use lowercase letters, numbers and single dashes only.';
  }
  return undefined;
}
