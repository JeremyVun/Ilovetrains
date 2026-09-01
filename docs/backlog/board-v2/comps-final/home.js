/* ===========================================================================
   HOME — the smart header as a DIRECTIONS OBJECT.

   Owner: "When a trip is focused, we'd need to show it in the smart header… So
   a user just needs to open the app, and straight away it'll tell you what you
   need to do next, and where you are in the trip."

   The header keeps every part it had — figure, the two ends of the journey, the
   journey drawn to scale, one line of type, a receipt — and three of them change
   job. The figure changes REFERENT with the state (dir.js). The third line
   becomes the INSTRUCTION. The bar gains the MARKER, which is why the dwell gap
   had to be drawn to scale first: the gap is where the marker stands during the
   change, and the change is the state the whole device exists for.

   Classic script, file:// origin.  Reads hdata.js's model(), dir.js's DIR and
   bar.js's SY_BAR — no invented data.
   =========================================================================== */
(function () {
  var m = model(scenarioName());
  var d = m.d;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function on(code) { return 'var(--' + (INK_ON[code] === 'ink' ? 'ink' : 'bg') + ')'; }
  function vars(a, b) {
    return '--stem:var(--line-' + a + ');--stem2:var(--line-' + (b || a) + ');'
      + '--chipink:' + on(a) + ';--chipink2:' + on(b || a) + ';';
  }

  /* DEFECT 3 + ROUND 5 CORRECTION 6, owner: "why not both?" — the stacked
     vertical colour rules AND the coloured `T` badges. The rules are the row's
     left edge and say at a glance how many trains a trip is; the badges name the
     lines inside the sentence, where a human reads "Rhodes to Bondi Junction".
     This re-admits the line code on HOME only; it stays deleted on board rows,
     where colour plus headsign already name the service. */
  function spine(legs) {
    return '<span class="hm-spine">' + legs.map(function (l) {
      return '<i style="background:var(--line-' + l.code + ')"></i>';
    }).join('') + '</span>';
  }
  function badge(code) {
    return '<b class="hm-bdg" style="background:var(--line-' + code + ');color:' + on(code) + '">'
      + esc(code) + '</b>';
  }

  /* ---- the top strip -------------------------------------------------------
     THE SWITCH. The owner ruled that focusing a trip is consent and that there
     is therefore no "I'm not on this" control — "if they want to track something
     else, that is implicit in their action to track something else" — which
     makes switching the ONLY correction the design offers, and it has to be
     cheap and obvious from the header. So the strip's left half names the thing
     being tracked and wears a chevron, and what it opens is the list that is
     already on screen one thumb below it. Nothing new is built; the header just
     stops hiding where the correction lives. */
  function top() {
    return '<div class="hm-top">'
      + '<button class="hm-track"><span class="t">' + esc(m.c.tracking) + '</span>'
      + '<span class="g">&#8964;</span></button>'
      + '<span class="hm-fresh"><span class="pulse live"></span><span class="lbl">Live</span></span>'
      + '</div>';
  }

  /* ---- THE SMART HEADER ----------------------------------------------------- */
  function header() {
    var j = m.j;
    var l1 = j.legs[0].code, l2 = (j.legs[1] || j.legs[0]).code;
    return '<button class="hm-hd' + (m.fig.length > 2 ? ' wide' : '') + '" style="' + vars(l1, l2) + '">'
      + '<span class="hm-fig"><span class="hm-n">' + esc(m.fig) + '<span class="hm-u">min</span></span>'
      /* The slot the board keeps silent on an ordinary service now carries the
         figure's REFERENT, out of the vocabulary STYLES already binds:
         `TO CHANGE`, `TO GO` (the shipped strip's own `47min to go`), `AGO`. */
      + '<span class="hm-st' + (d.warn ? ' warn' : '') + '">' + esc(m.prov) + '</span></span>'
      + '<span class="hm-ends">'
      + '<span class="hm-e from"><span class="hm-stn">' + esc(j.from) + '</span>'
      + '<span class="hm-t">' + j.dep + '</span></span>'
      + '<span class="hm-e to"><span class="hm-stn">' + esc(j.to) + '</span>'
      + '<span class="hm-t">' + j.arr + '</span></span>'
      + '</span>'
      /* THE CAP ANSWERS "WHERE DO YOU BOARD", so it is printed until you have,
         and then it is gone. Two platform numbers on one screen is the ambiguity
         this whole round of complaints is about: standing in the dwell at Town
         Hall, a `PLATFORM 1` cap and an instruction reading `Platform 5` are the
         same defect as the big minutes figure being read as a platform. What
         replaces it is not blank space — the bar takes the full measure, so the
         journey is drawn across the whole page and the marker has 118 more pixels
         to be precise in. The boarding platform is not lost; it is in the journey
         detail view, where a fact you have already used belongs. */
      + '<span class="sy-j">'
      + (d.at > 0 ? '' : '<span class="sy-cap">Platform ' + esc(j.plat) + '</span>')
      + '<span class="sy-bar">' + SY_BAR(DIR_BAR(d, true)) + '</span></span>'
      /* THE INSTRUCTION. `focus.js`'s own ordering: what is wrong, then what you
         must do, then where you are going. An exception takes the line whole,
         which is the cancelled lead's precedent on the board. */
      + '<span class="hm-sign' + (d.warn ? ' note' : d.act ? ' hm-act' : '') + '">' + esc(d.instruction) + '</span>'
      + (m.c.receipt ? '<span class="hm-rec">' + esc(m.c.receipt) + '</span>' : '')
      + '</button>';
  }

  function offer() {
    var o = m.c.offer;
    return '<div class="hm-offer"><div class="r"></div><span class="k">' + esc(o.k) + '</span>'
      + '<p>' + esc(o.p) + '</p>'
      + '<div class="hm-acts"><button>' + esc(o.yes) + '</button>'
      + '<button class="q">' + esc(o.no) + '</button></div></div>';
  }

  /* ---- the index ------------------------------------------------------------ */
  function index() {
    function row(x, i) {
      var top = i === 0;
      /* The tracked trip keeps its place — the heuristic must never hide a trip
         — and states its relationship to the thing above in the slot where its
         distance would otherwise go. */
      var lead = top ? (m.rode ? 'Tracking in reverse' : 'Tracking now')
        : (m.fix ? esc(x.dist) + ' away' : '');
      var sub = (lead ? '<b>' + lead + '</b> &middot; ' : '') + esc(x.rode);
      var L = x.legs;
      var name = L.length < 2
        ? badge(L[0].code) + esc(x.from) + ' <em>&rarr;</em> ' + esc(x.to)
        : badge(L[0].code) + esc(x.from) + ' <em>&rarr;</em> ' + badge(L[1].code) + esc(x.to);
      return '<button class="tripr' + (top ? ' top' : '') + '" data-svc>'
        + '<span class="hm-in">' + spine(L)
        + '<span class="hm-bd"><span class="hm-nm">' + name + '</span>'
        + '<span class="hm-sub">' + sub + '</span></span></span></button>';
    }
    /* `tl` is carried purely so shoot.js's scroller probe can find this box; it
       is the class the instrument looks for and base.css never styles it. */
    return '<div class="hm-ix tl">'
      /* The label now names the ACTION the list performs while a trip is being
         tracked, which is the other half of the switch. */
      + '<div class="hm-anchor"><div class="l">Track another trip</div></div>'
      + m.trips.map(row).join('')
      + '<div class="hm-end">&mdash; That&rsquo;s everything on this phone</div>'
      + '</div>';
  }

  function thumbBar() {
    return '<div class="hm-bar"><button><span class="g">&#43;</span>New trip</button>'
      + '<span class="sp"></span><button class="q">Edit</button></div>';
  }

  function ask() {
    var a = m.c.ask;
    return '<div class="hm-ask"><span class="k">' + esc(a.k) + '</span>'
      + '<p>' + esc(a.p) + '</p>'
      + '<div class="hm-acts"><button>' + esc(a.yes) + '</button>'
      + '<button class="q">' + esc(a.no) + '</button></div></div>';
  }

  /* ---- add a trip ------------------------------------------------------------ */
  function sheet(ready) {
    var res = ready ? '' :
      '<div class="hm-grp">Matches</div><div class="hm-res">'
      + MATCHES.map(function (r) {
          return '<button><span class="n"><b>' + esc(r.hit) + '</b>' + esc(r.tail) + '</span>'
            + '<span class="w">' + esc(r.why) + ' &middot; ' + r.line + '</span></button>';
        }).join('')
      + '</div>'
      + '<div class="hm-grp">You searched before</div><div class="hm-res">'
      + RECENT.map(function (n) {
          return '<button><span class="n">' + esc(n) + '</span></button>';
        }).join('') + '</div>';

    return '<div class="hm-top"><button class="hm-back"><span class="g">&larr;</span>Home</button></div>'
      + '<div class="hm-mast"><h1>New trip</h1><div class="r"></div></div>'
      + '<div class="hm-sheet">'
      + '<button class="hm-field"><span class="lbl">From</span>'
      + (ready ? '<span class="v">Rhodes</span>'
               : '<span class="v">Rhode<span class="caret"></span></span>') + '</button>'
      + '<button class="hm-field"><span class="lbl">To</span>'
      + '<span class="v">Bondi Junction</span></button>'
      + res
      + '<p class="hm-lede">Saved trips sit on your home screen. '
      + 'Save <b>one direction only</b> &mdash; when today&rsquo;s ride is done, '
      + 'the way back is already waiting.</p>'
      + '</div>'
      + (ready
          ? '<div class="hm-bar save"><button>Save Rhodes &rarr; Bondi Junction</button></div>'
          : '<div class="hm-bar save"><button disabled>Choose where you start</button></div>');
  }

  var out;
  if (m.screen === 'add') out = sheet(false);
  else if (m.screen === 'save') out = sheet(true);
  else {
    out = top() + header() + (m.c.offer ? offer() : '')
      + '<div class="hm-rule"></div>'
      + index() + (m.ask ? ask() : thumbBar());
  }
  document.getElementById('app').innerHTML = out;
  SY_BAR_CLAMP(document);
})();
