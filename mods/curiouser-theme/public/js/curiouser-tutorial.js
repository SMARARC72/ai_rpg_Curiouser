/*
 * Curiouser — in-game tutorial / onboarding.
 * ------------------------------------------------------------------------
 * A themed, multi-step "How to Play" guide that auto-opens the first time a
 * player lands on the chat page (remembered in localStorage) and stays
 * reopenable from a floating button. It explains what Curiouser is, how a turn
 * works, WHERE each panel lives, and how the stakes (Ink / Ratings / Legacy /
 * Episodes / Curveballs / Sponsors) work.
 *
 * Auto-injected into the chat page by the mod loader (theme mod public/js).
 * Pure client add-on; no core changes. Content is static/trusted.
 */
(function () {
  'use strict';

  var SEEN_KEY = 'curiouser_tutorial_seen_v1';

  var STEPS = [
    {
      title: '🎙️ Welcome to the show',
      html: "You're the newest contestant on <b>CURIOUSER</b> — a live cosmic gameshow broadcast to an audience of bored immortals. Your job is simple: <b>entertain them</b>. Bomb, and you get <b>Cancelled</b>. Your narrator, gamemaster, and co-star is <b>the Host</b> — manic, delighted, and also your entire HUD."
    },
    {
      title: 'How you play',
      html: "Type what your character <i>does</i> in the box at the bottom and hit <b>Send</b>. The Host narrates what happens — then the world pushes back: cast members scheme, the Audience reacts out loud, and live <b>Curveballs</b> drop. Every world runs on one weird, <i>exploitable</i> House Rule. Don't just survive it — work it. Clever beats loud."
    },
    {
      title: 'Where everything is',
      html: "<ul class=\"cur-tut-list\">" +
        "<li><b>Left panel</b> — the scene: where you are, the <b>exits</b>, who's here, and what's lying around.</li>" +
        "<li><b>Center</b> — the show itself: the Host's narration and your actions.</li>" +
        "<li><b>Right panel</b> — <b>you</b>: health, your gear (<b>Inventory</b>), and your survival meters.</li>" +
        "<li><b>Top tabs</b> — Map, Character, Quests, Factions, Party, Story Tools, and the Scenes gallery.</li>" +
        "</ul>"
    },
    {
      title: 'The stakes',
      html: "<b>Ink</b> is your wallet — literally the ink your story is drawn in. Three more meters stay hidden and the Host <i>speaks</i> them instead of showing a dashboard:" +
        "<ul class=\"cur-tut-list\">" +
        "<li><b>Ratings</b> — are you entertaining right now?</li>" +
        "<li><b>Audience Favor</b> — does the crowd love you?</li>" +
        "<li><b>Legacy</b> — your season-long status.</li>" +
        "</ul>" +
        "Each <b>Episode</b> sets a Ratings bar: clear it to be <b>Renewed</b>, miss it twice and you're <b>Cancelled</b> (it burns Legacy, but you can be rebooted). <b>Sponsors</b> offer Ink with a catch — take the deal or stay pure and broke."
    },
    {
      title: 'The Prop Department',
      html: "See the <b>🔧 Prop Shop</b> button (bottom-left)? That's your workshop. <b>Salvage</b> loot into parts, <b>Craft</b> gear from recipes or wild <b>experiments</b>, <b>Build</b> barricades and traps into the scene, and upgrade your <b>Green Room</b> base — including a <b>Prop Vault</b> that keeps your best props even if you're Cancelled."
    },
    {
      title: 'Roll the cameras',
      html: "Hit <b>New Game</b> in the top bar to spin up your first world and step into the lights. You can reopen this guide any time from the <b>🎙️ How to Play</b> button in the corner.<br><br>Break a leg. You'll need to.",
      cta: { label: '🎬 Start New Game', href: '/new-game' }
    }
  ];

  var overlay = null;
  var index = 0;

  function seen() {
    try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { window.localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
  }

  function el(tag, className, html) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function build() {
    overlay = el('div', 'cur-tut-backdrop');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var modal = el('div', 'cur-tut-modal');

    var header = el('div', 'cur-tut-header');
    var title = el('div', 'cur-tut-title');
    var close = el('button', 'cur-tut-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    close.addEventListener('click', hide);
    header.appendChild(title);
    header.appendChild(close);

    var body = el('div', 'cur-tut-body');

    var dots = el('div', 'cur-tut-dots');

    var footer = el('div', 'cur-tut-footer');
    var back = el('button', 'btn cur-tut-btn cur-tut-back');
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', function () { go(index - 1); });
    var cta = el('a', 'btn cur-tut-btn cur-tut-cta');
    cta.style.display = 'none';
    var next = el('button', 'btn cur-tut-btn cur-tut-next');
    next.type = 'button';
    next.addEventListener('click', function () {
      if (index >= STEPS.length - 1) { hide(); } else { go(index + 1); }
    });
    footer.appendChild(back);
    footer.appendChild(cta);
    footer.appendChild(next);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(dots);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });
    document.addEventListener('keydown', function (e) {
      if (!overlay || overlay.style.display === 'none') return;
      if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowRight') next.click();
      else if (e.key === 'ArrowLeft') back.click();
    });

    document.body.appendChild(overlay);

    overlay.__refs = { title: title, body: body, dots: dots, back: back, next: next, cta: cta };
  }

  function go(i) {
    index = Math.max(0, Math.min(STEPS.length - 1, i));
    var step = STEPS[index];
    var r = overlay.__refs;
    r.title.textContent = step.title;
    r.body.innerHTML = step.html;
    r.back.style.visibility = index === 0 ? 'hidden' : 'visible';
    r.next.textContent = index === STEPS.length - 1 ? "Got it — let's go" : 'Next ›';
    if (step.cta) {
      r.cta.textContent = step.cta.label;
      r.cta.setAttribute('href', step.cta.href);
      r.cta.style.display = '';
      r.cta.onclick = markSeen;
    } else {
      r.cta.style.display = 'none';
    }
    // dots
    r.dots.innerHTML = '';
    for (var d = 0; d < STEPS.length; d++) {
      var dot = el('span', 'cur-tut-dot' + (d === index ? ' is-active' : ''));
      (function (target) { dot.addEventListener('click', function () { go(target); }); })(d);
      r.dots.appendChild(dot);
    }
  }

  function show() {
    if (!overlay) build();
    overlay.style.display = 'flex';
    go(index || 0);
  }
  function hide() {
    if (overlay) overlay.style.display = 'none';
    markSeen();
  }
  function open() {
    index = 0;
    show();
  }

  function addReopenButton() {
    if (document.getElementById('curTutReopen')) return;
    var b = el('button', 'cur-tut-reopen');
    b.id = 'curTutReopen';
    b.type = 'button';
    b.textContent = '🎙️ How to Play';
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  function init() {
    addReopenButton();
    if (!seen()) {
      window.setTimeout(open, 700);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
