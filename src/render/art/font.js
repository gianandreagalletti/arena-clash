// The pixel UI font, loaded via Google Fonts (index.html) — OFL licensed,
// same family the brief suggests bundling locally. Only used at the sizes
// below (integer multiples, no fractional/blurry sizes).
//
// PIXEL_FONT_FAMILY includes a monospace fallback for canvas text rendering
// if the network font ever fails to load (offline, blocked CDN, etc.) — the
// game should degrade to a readable font, not a silent browser-default serif.
// PIXEL_FONT_LOAD_NAME is the bare family name document.fonts.load() needs.
export const PIXEL_FONT_LOAD_NAME = 'Press Start 2P';
export const PIXEL_FONT_FAMILY = `"${PIXEL_FONT_LOAD_NAME}", monospace`;

export const PIXEL_FONT_SIZES = {
  small: '8px',
  base: '16px',
  large: '24px',
  huge: '32px',
};
