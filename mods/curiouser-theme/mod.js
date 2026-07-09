/**
 * Curiouser Theme (comic-book / ink).
 *
 * A theming mod: the visual work is entirely in public/css/curiouser-theme.css,
 * which the mod loader injects into the page for any loaded mod. This mod.js
 * exists only so the directory is a valid, loadable mod (a public-only folder is
 * not) — register() is intentionally a no-op.
 */

module.exports.meta = {
  name: 'Curiouser Theme',
  version: '1.0.0',
  description: 'Comic-book / ink CSS reskin of the UI (cream paper, black ink borders, halftone, comic type, bubble chat).'
};

module.exports.register = function register() {
  console.log('      🖋️  Curiouser Theme loaded (comic-book / ink)');
};
