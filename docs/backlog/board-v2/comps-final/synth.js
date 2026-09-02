/* ===========================================================================
   SYNTHESIS BOARD — shared renderer. `LEAD` is set by the host page:
   synth-a.html (uniform rows) sets false, synth-b.html (lead answer) sets true.
   Classic script, file:// origin. Reads data.js's model() — no invented data.
   =========================================================================== */
(function () {
  var LEAD = !!window.SY_LEAD;
  /* ROUND 5: T2 SHIPS. The joined variant is deleted — the dwell gap stays and
     is bracketed by the alight numeral and the boarding numeral, strictly to
     scale (bar.js). `SY_STRIP` is the one thing the host page still varies, and
     it is this round's open structural question: does the board focus strip survive
     now that the home smart header carries the tracked trip? */
  var STRIP = window.SY_STRIP !== false;

  /* Knocked-out ink on a filled line colour, measured not assumed (Board v2
     amendment). For each TfNSW line the WCAG ratio of the page's ink and the
     page's ground against that fill were computed; the better of the two is
     used, and the worst case across the whole palette is M1 at 4.16:1 — above
     the 3:1 large-text floor the amendment sets for 14px/700. In light mode a
     single rule in synth.css overrides all of these to the ground, because on
     paper the fill's ink is the ground for every line. */
  var KNOCKOUT = {
    T1: 'bg', BMT: 'bg', T3: 'bg', T2: 'bg', SCO: 'bg', T7: 'bg',
    T8: 'bg', SHL: 'bg', M1: 'bg',
    T4: 'ink', T9: 'ink', CCN: 'ink', T5: 'ink', HUN: 'ink'
  };

  var m = model(scenarioName() === 'landing' ? 'past' : scenarioName());
  if (scenarioName() === 'landing') m.scrolled = false;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function hm(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }
  function span(a, b) { var d = hm(b) - hm(a); return d < 0 ? d + 1440 : d; }
  function ink(line) { return 'var(--' + (KNOCKOUT[line] === 'ink' ? 'ink' : 'bg') + ')'; }
  function vars(r) {
    return '--stem:var(--line-' + r.line + ');'
      + '--stem2:var(--line-' + (r.line2 || r.line) + ');'
      + '--chipink:' + ink(r.line) + ';'
      /* the transfer numeral is knocked out of ITS OWN line's fill, measured the
         same way: T4 as ink on the page ground is 2.8:1, which is why the numeral
         is set on the fill and not on the paper. */
      + '--chipink2:' + ink(r.line2 || r.line) + ';';
  }

  /* THE JOURNEY, TO SCALE — bar.js's coordinate system. Every number handed to
     it is a real number of minutes read off the fixture; nothing is rounded and
     nothing is chosen. A board row carries no progress: these are services you
     have not boarded. */
  function bar(r, caps, prog) {
    if (!r.line2 || !r.chg) return SY_BAR({ legs: [{ mins: span(r.dep, r.arr) || 1 }] });
    return SY_BAR({
      legs: [{ mins: span(r.dep, r.chg.in) }, { mins: span(r.chg.out, r.arr) }],
      dwell: span(r.chg.in, r.chg.out),
      pIn: caps ? esc(r.chg.pIn) : '', pOut: caps ? esc(r.chg.pOut) : '',
      tight: !!r.tight, caps: !!caps, prog: prog || null
    });
  }

  function mast() {
    return '<div class="sy-mast">'
      + '<div class="sy-top">'
      /* Back navigation is named after where it goes. It is the only control on
         the board: EARLIER, NOW and REVERSE are all gone. */
      + '<button class="sy-home"><span class="g">&larr;</span>Home</button>'
      + '<span class="sy-fresh"><span class="pulse live"></span><span class="lbl">Live</span></span>'
      + '</div>'
      /* The masthead names the trip and keys the columns under it. */
      + '<h1 class="sy-h1"><b>' + esc(m.from) + '</b><span class="conn"></span>'
      + '<b>' + esc(m.to) + '</b></h1>'
      + '<div class="sy-hr"></div></div>';
  }

  /* ONE ROW OBJECT for both halves of the board (owner ruling, round 4: "past
     trip rows … should look the same, but just be greyed out with the verb
     'ago' underneath the time"). Same grid, same four justified numbers, same
     platform cap, same colour bar; a past row differs by a modifier class, an
     elapsed figure, and the word under it. */
  function row(r, i, note) {
    var isLead = LEAD && i === 0 && !r.past;
    var cls = 'sy-row' + (isLead ? ' lead' : '') + (r.cx ? ' cx' : '')
      + (r.past ? ' past ' + (r.pastKind === 'actual' ? 'ac' : 'tt') : '')
      + (r.claimLate ? ' late' : '') + (r.sched ? ' sched' : '')
      + (r.fig.length > 2 ? ' wide' : '');
    /* The slot keeps its reserved height on every row and prints only when it
       has an exception or a tense to state — `ON TIME` is deleted (round 4). */
    var dep = r.past ? r.pastDep : r.dep;
    /* The delay uses both numbers as required by docs/contracts/ui.md. On a
       past row it is the whole punctuality claim, and it is why
       the provenance slot is free to say AGO. It is printed only where the
       record backs it — never on a timetable-only row. */
    var was = (r.pastStruck || (!r.past && r.planned))
      ? '<del class="sy-was">' + (r.pastStruck || r.planned) + '</del>' : '';
    var warn = r.cx || (r.claimLate && !r.past);
    return '<div data-svc' + (r.past ? ' data-past' : '') + ' class="' + cls + '" style="' + vars(r) + '">'
      + '<div class="sy-fig"><span class="sy-n">' + r.fig
      + (r.cx || r.fig === 'Now' ? '' : '<span class="sy-u">min</span>') + '</span>'
      + '<span class="sy-st' + (warn ? ' warn' : '') + '">' + r.state + '</span></div>'
      + '<div class="sy-t"><span class="sy-dp">' + dep + '</span>' + was
      + '<span class="sy-ar">' + r.arr + '</span></div>'
      + '<div class="sy-j"><span class="sy-cap">Platform ' + r.plat + '</span>'
      + '<div class="sy-bar">' + bar(r, true) + '</div></div>'
      + (note ? '<div class="sy-sign note">' + note + '</div>'
              : '<div class="sy-sign">' + esc(r.head) + '</div>')
      + '</div>';
  }

  function endMark() {
    if (m.next.length > 3) return '';
    var last = m.next.length ? m.next[m.next.length - 1].dep
      : m.past.length ? m.past[m.past.length - 1].pastDep : m.now;
    return '<div class="sy-end"><b>&mdash; End of board</b>'
      + '<span>Nothing scheduled after ' + last + '.</span></div>';
  }

  /* THE BOARD FOCUS STRIP, rebuilt in the directions grammar so the with/without
     comparison this round has to make is a fair one. It is the same object as
     the home header — same figure, same referent word, same instruction, same
     bar with the same marker — which is exactly the question: home header,
     focus strip and journey detail would be three renderings of one thing. */
  function strip() {
    if (!m.focus || !STRIP) return '';
    var r = m.focus;
    var d = DIR({
      from: m.from, to: m.to, plat: r.plat, dep: r.dep, arr: r.arr,
      head: r.head, arrPlat: r.arrPlat,
      legs: [{ code: r.line, mins: span(r.dep, r.chg.in) },
             { code: r.line2, mins: span(r.chg.out, r.arr) }],
      chg: { at: r.chg.at, mins: r.chg.mins, pIn: r.chg.pIn, pOut: r.chg.pOut }
    }, m.now);
    return '<div class="sy-strip" style="' + vars(r) + '">'
      + '<div class="sy-s1"><span class="sy-n">' + d.figure + '<span class="sy-u">min</span></span>'
      + '<span class="k">' + d.prov.toLowerCase() + '</span>'   /* NO `to go` fallback:
         before departure the figure is minutes to departure and the slot is
         silent, exactly as it is on a board row. The fallback printed
         `3min TO GO` on a train that had not left. */
      + '<span class="t">' + esc(m.to) + ' ' + r.arr + '</span></div>'
      /* Same rule as the header: the cap answers "where do you board", so it goes
         once you have. Kept identical here on purpose — the with/without decision
         has to be between two renderings of the SAME object, not between a new
         one and an old one. */
      + '<div class="sy-sj">'
      + (d.at > 0 ? '' : '<span class="sy-cap">Platform ' + r.plat + '</span>')
      + '<span class="sy-bar">' + SY_BAR(DIR_BAR(d, true)) + '</span></div>'
      + '<div class="sy-s2">' + esc(d.instruction) + '</div>'
      + '</div>';
  }

  function board() {
    var note = null;
    if (m.rows[0] && m.rows[0].cx) note = m.rows[0].dep + ' cancelled &middot; next train';
    var fut = m.next.map(function (r, i) {
      /* A connection at risk replaces the headsign with the warning, exactly as
         the cancelled lead does (the cancellation precedent in docs/contracts/ui.md). In t2 the coral
         gap says it in the picture as well; in t1 this line is the only place
         it can be said at all. */
      if (r.tight) return row(r, i, 'Tight change &middot; ' + r.chg.mins + ' min');
      return row(r, i, i === 1 ? note : null);
    }).join('');
    return mast()
      /* `tl` is carried purely so shoot.js's scroller probe can find this box:
         it is the class the instrument looks for and base.css never styles. */
      + '<div class="sy-tl tl' + (m.next.length ? '' : ' empty') + '">'
      + m.past.map(function (r) { return row(r, -1, null); }).join('')
      /* Everything from NOW down is one block that is at least a frame tall.
         That is what makes "lands at now" mechanical rather than hopeful: the
         anchor can always be scrolled to the top edge, so the past is always
         above the fold on open however few services have run. It also keeps
         the shipped rule that the board FILLS the frame — the rows distribute
         inside this block exactly as they did when there was no past at all. */
      /* `sparse` relaxes the row cap so a two-service board breathes instead of
         huddling under the anchor — but ONLY when nothing has run yet. With a
         past above the rule the frame is already full, and the relaxation made
         a future row 168px tall against a past row of 98, which is exactly the
         difference the owner asked to be removed ("they should look the same"). */
      + '<div class="sy-fwd' + (m.next.length ? (m.next.length <= 3 && !m.past.length ? ' sparse' : '') : ' void') + '">'
      + '<div class="sy-now' + (m.past.length ? '' : ' top') + '" id="sy-anchor"><div class="r"></div>'
      + '<div class="l">Now &middot; ' + m.now + '</div></div>'
      + fut + endMark()
      + '</div></div>' + strip();
  }

  if (LEAD) document.body.classList.add('sy-vb');
  document.getElementById('app').innerHTML = board();

  /* Complaint 1's binding half: the board LANDS at now. The past is in the
     document — you scroll up into it, which is the phone's own language — but
     the scroller opens with the anchor at its top edge, never inside the past. */
  var tl = document.querySelector('.sy-tl');
  var anchor = document.getElementById('sy-anchor');
  if (tl && anchor && !m.scrolled) tl.scrollTop = anchor.offsetTop;
})();
