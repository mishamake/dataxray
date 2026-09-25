// contracts/share-link.mjs
// Share-link contract v1: a URL that restores a dashboard view and focuses one card.
//   ?focus=<permanent target ID>&view=<URL-encoded JSON of string-valued controls>
// Pure and framework-free. Links carry view state only: never credentials or data
// values, and they grant no access.
//
// Compatibility rules (see UPGRADING.md):
//   - Target IDs are permanent. Never derive them from titles or positions; keep an
//     alias when replacing one; never recycle an ID for a different metric.
//   - Add optional view fields with backward-compatible defaults. If a meaning must
//     change, bump SHARE_LINK_VERSION and keep the old reader.

export const SHARE_LINK_VERSION = 1;
/** Leaves room for an encoded sign-in/onboarding return destination. */
export const MAX_SHARE_LINK_LENGTH = 2000;
export const MAX_VIEW_PARAM_LENGTH = 8000;
export const MAX_VIEW_VALUE_LENGTH = 4000;

export class ShareLinkError extends Error {
  constructor(message = 'This view has too many filters to share. Reduce the selection and try again.') {
    super(message);
    this.name = 'ShareLinkError';
  }
}

/**
 * Parse the `view` query parameter. Absent → {} (default view). Invalid → null, so
 * the host can say the link is invalid instead of silently replacing its filters.
 * @param {string|null|undefined} value
 * @returns {Record<string,string>|null}
 */
export function parseShareView(value) {
  if (value == null) return {};
  if (!value || value.length > MAX_VIEW_PARAM_LENGTH) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (!entries.every(([, v]) => typeof v === 'string' && v.length <= MAX_VIEW_VALUE_LENGTH)) return null;
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

/**
 * Build a card link from the current location. Unrelated query/hash state is
 * removed. Throws ShareLinkError rather than truncating controls to make it fit.
 * @param {string} location     current absolute URL
 * @param {string} targetId     permanent target ID
 * @param {Record<string,string>} [view]
 * @returns {string}
 */
export function buildShareLink(location, targetId, view = {}) {
  const url = new URL(location);
  const encoded = JSON.stringify(view);
  if (JSON.stringify(parseShareView(encoded)) !== encoded) throw new ShareLinkError();
  url.search = new URLSearchParams({ focus: targetId, view: encoded }).toString();
  url.hash = '';
  if (url.href.length > MAX_SHARE_LINK_LENGTH) throw new ShareLinkError();
  return url.href;
}

/**
 * Read focus/view from URLSearchParams (or anything with get()).
 * @param {{get(name:string):string|null}|null|undefined} params
 * @returns {{focus:string, view:Record<string,string>, invalid:boolean, key:string}}
 */
export function readShareParams(params) {
  const focus = params?.get('focus') ?? '';
  const raw = params?.get('view') ?? null;
  const view = parseShareView(raw);
  return { focus, view: view ?? {}, invalid: view === null, key: `${focus}:${raw ?? ''}` };
}

/** Every present control is one of its allowed values. */
export function shareChoicesValid(view, choices) {
  return Object.entries(choices).every(([key, allowed]) => view[key] === undefined || allowed.includes(view[key]));
}

/** Validated enum control with a fallback. */
export function shareChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

/** A real calendar date in YYYY-MM-DD form, else undefined. */
export function shareDate(value) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value ? value : undefined;
}

/**
 * Anchor relative presets ("MTD", "last quarter") to a shared reporting date.
 * Rejects invalid or future dates in the reporting time zone. Returns local noon
 * UTC of that date so a date never shifts across US time zones.
 * @param {string|null|undefined} value
 * @param {{timeZone?:string, now?:Date}} [opts]
 * @returns {Date}
 */
export function shareAsOf(value, opts = {}) {
  const { timeZone = 'UTC', now = new Date() } = opts;
  if (!value) return now;
  const today = now.toLocaleDateString('en-CA', { timeZone });
  if (!shareDate(value) || value > today) throw new ShareLinkError('Invalid shared reporting date.');
  return new Date(`${value}T12:00:00Z`);
}
