// ── SVG icons ──
// Single source of truth for the viewer's inline icons: `currentColor`
// strings injected as innerHTML by the module that uses them, so a shape
// or stroke tweak lands in one place. Add new icons here as named exports
// rather than hand-inlining SVG in index.html.

// Hamburger — the sidebar toggle button.
export const HAMBURGER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="4" y1="7" x2="20" y2="7" />
  <line x1="4" y1="12" x2="20" y2="12" />
  <line x1="4" y1="17" x2="20" y2="17" />
</svg>`;

// Close (×) — the sidebar toggle while the sidebar is open.
export const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <line x1="6" y1="6" x2="18" y2="18" />
  <line x1="18" y1="6" x2="6" y2="18" />
</svg>`;

// Newspaper — the What's New button.
export const NEWSPAPER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
  <line x1="6.5" y1="9" x2="17.5" y2="9" />
  <line x1="6.5" y1="12.5" x2="12" y2="12.5" />
  <line x1="6.5" y1="15.5" x2="12" y2="15.5" />
  <rect x="14" y="12.5" width="3.5" height="3.5" rx="0.5" />
</svg>`;
