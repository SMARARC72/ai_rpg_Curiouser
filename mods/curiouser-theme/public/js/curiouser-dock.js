/*
 * Curiouser Dock — one launcher to replace the scattered floating buttons.
 * ------------------------------------------------------------------------
 * A single expandable FAB (bottom-left). Every Curiouser panel registers a
 * menu item instead of spawning its own floating button:
 *
 *   (window.__CUR_DOCK__ = window.__CUR_DOCK__ || []).push({ icon, label, onClick });
 *   window.__CUR_DOCK_RENDER__ && window.__CUR_DOCK_RENDER__();
 *
 * Order-independent: items registered before the dock initializes are queued
 * in window.__CUR_DOCK__ and drained on init. Lives in the theme mod because
 * it's shared UX chrome.
 */
(function () {
  'use strict';
  window.__CUR_DOCK__ = window.__CUR_DOCK__ || [];
  var wrap = null, listEl = null, open = false;

  function setOpen(v) { open = v; if (wrap) wrap.classList.toggle('is-open', open); }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    (window.__CUR_DOCK__ || []).forEach(function (it) {
      if (!it || !it.label) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cur-dock-item';
      b.innerHTML = '<span class="cur-dock-item-icon">' + (it.icon || '•') + '</span><span class="cur-dock-item-label"></span>';
      b.querySelector('.cur-dock-item-label').textContent = it.label;
      b.addEventListener('click', function () { setOpen(false); try { it.onClick && it.onClick(); } catch (e) {} });
      listEl.appendChild(b);
    });
  }

  function build() {
    wrap = document.createElement('div');
    wrap.className = 'cur-dock';

    listEl = document.createElement('div');
    listEl.className = 'cur-dock-menu';

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'cur-dock-fab';
    fab.setAttribute('aria-label', 'Open the show menu');
    fab.innerHTML = '<span class="cur-dock-fab-bars">☰</span><span class="cur-dock-fab-text">Menu</span>';
    fab.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!open); });

    wrap.appendChild(listEl);
    wrap.appendChild(fab);
    document.body.appendChild(wrap);

    document.addEventListener('click', function (e) { if (open && wrap && !wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') setOpen(false); });
    render();
  }

  window.__CUR_DOCK_RENDER__ = render;

  function init() { if (!wrap) build(); else render(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
