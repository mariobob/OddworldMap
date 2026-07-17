// ── SVG icons ──
// Single source of truth for the viewer's inline icons: `currentColor`
// strings injected as innerHTML by the module that uses them, so a shape
// or stroke tweak lands in one place. Add new icons here as named exports
// rather than hand-inlining SVG in index.html.

// Newspaper — the What's New button.
export const NEWSPAPER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
  <line x1="6.5" y1="9" x2="17.5" y2="9" />
  <line x1="6.5" y1="12.5" x2="12" y2="12.5" />
  <line x1="6.5" y1="15.5" x2="12" y2="15.5" />
  <rect x="14" y="12.5" width="3.5" height="3.5" rx="0.5" />
</svg>`;
