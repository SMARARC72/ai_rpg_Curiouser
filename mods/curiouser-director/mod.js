/**
 * Curiouser Director — wires the comic-assembly mod into play.
 *
 * The comic mod (curiouser-comic) can turn "panel beats" into composited pages
 * and export a chapter, but nothing fed it during play. This mod is the missing
 * client glue: a Comic panel with Snap Panel / Compose Page / Export Chapter,
 * plus auto-capture of the big stakes beats (Episode wraps, Cancellations). All
 * the visual work is in public/js + public/css; register() is a no-op so the
 * public-only folder loads as a valid mod.
 */
module.exports.meta = {
  name: 'Curiouser Director',
  version: '1.0.0',
  description: 'Comic capture: snap panels from play, compose pages, and export your chapter.'
};

module.exports.register = function register() {
  console.log('      🎬 Curiouser Director loaded (comic capture)');
};
