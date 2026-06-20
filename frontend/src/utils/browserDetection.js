/**
 * Detects if the current environment is an in-app browser (e.g., WhatsApp, Instagram).
 * Returns true if an in-app browser is detected.
 * Uses case-insensitive matching for reliable detection.
 */
export const isInAppBrowser = () => {
  if (typeof window === 'undefined') return false;
  const ua = (navigator.userAgent || navigator.vendor || '').toLowerCase();

  // Comprehensive list of known in-app browser User-Agent substrings
  const inAppPatterns = [
    'instagram', 'fban', 'fbav', 'fb_iab',
    'twitter', 'line/', 'wechat', 'micromessenger',
    'whatsapp', 'snapchat', 'telegram', 'tiktok',
    'linkedin', 'slack', 'discord', 'teams',
    'pinterest'
  ];

  return inAppPatterns.some(pattern => ua.includes(pattern));
};
