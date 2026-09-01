/* The detail view of a DEPARTED focused journey — "on this train".
 *
 * Shared by all three surface-B comps so the axis under test is the STRIP, not
 * the detail. Composition is A1·Ledger's, which is the surface-A
 * recommendation; a different winner there swaps this file, not the comps.
 *
 * The board no longer carries this journey (rowmodel.js drops departed
 * services and the board is right to). Everything here is rendered from the
 * focus snapshot, per docs/contracts/client-storage.md.
 *
 * The figure column keeps its job — it is always minutes — and the provenance
 * slot keeps its: it names what the figure IS. A leg you are riding says
 * ON BOARD, which is the same kind of word as DEPARTING (owner ruling D):
 * a state, not a unit, because "4 MIN" under a leg you are already on would
 * be a count of the wrong thing.
 */

function onboardDetailHtml(m, opt) {
  opt = opt || {};
  var j = m.focus, now = m.now, L = m.long;
  var a = j.legs[0], b = j.legs[1];
  var eff = function (l, w) { return l[w + 'Est'] === null ? l[w + 'Sched'] : l[w + 'Est']; };
  var arrTH = eff(a, 'arr'), depTH = eff(b, 'dep'), endMs = eff(b, 'arr');
  var toGo = minsBetween(now, endMs);

  function row(figure, prov, provWarn, depLine, meta, third, cls, stem) {
    return '<div class="row ' + (cls || '') + '" style="--stem:var(--line-' + stem + ')">' +
      '<div class="mins">' + figure +
        '<span class="prov' + (provWarn ? ' warn' : '') + '">' + prov + '</span></div>' +
      '<div class="body"><div class="dep">' + depLine + '</div>' +
        '<div class="meta">' + meta + '</div>' + third + '</div></div>';
  }

  var legA = row(
    minsBetween(now, arrTH), 'on board', false,
    '<strong>' + clock(arrTH) + '</strong><span class="to">off at ' +
      esc(L ? 'Town Hall Station' : 'Town Hall') + '</span>',
    /* The platform that matters on a train you are already on is the one you
       step onto, not the one you boarded from. */
    'Platform <b>' + a.to.platform.replace('Platform ', '') + '</b>' +
      '<span class="badge">' + esc(a.line.code) + '</span>',
    '<div class="dest">' + esc(L ? a.line.full : a.line.name) + ' to ' + esc(a.line.headsign) + '</div>',
    'first', a.line.code);

  var tight = j.changeMin < j.printedChangeMin && j.cancelledLeg !== 1;
  var chg =
    '<div class="row chg' + (tight ? ' tight' : '') + '">' +
      '<div class="mins">' + j.changeMin + '<span class="prov">to change</span></div>' +
      '<div class="body"><h2>' + esc(L ? 'Town Hall Station' : 'Town Hall') + '</h2>' +
        '<div class="meta">Platform <b>3</b><span class="arw">→</span>Platform <b>5</b></div>' +
        '<div class="dest">Arrive ' + clock(arrTH) +
          (tight ? ' <del>' + clock(a.arrSched) + '</del>' : '') +
          ' &nbsp;·&nbsp; leave ' + clock(depTH) +
          (j.cancelledLeg === 1 ? ' <del>' + b.replacedTime + '</del>' : '') + '</div>' +
        (tight ? '<div class="warnline">Printed change was ' + j.printedChangeMin + ' min</div>' : '') +
      '</div></div>';

  var legBmins = minsBetween(now, depTH);
  var legB = row(
    String(legBmins), 'min', false,
    '<strong>' + clock(depTH) + '</strong>' +
      (j.cancelledLeg === 1 ? '<del>' + b.replacedTime + '</del>' : '') +
      '<span class="to">arrives ' + clock(endMs) + '</span>',
    'Platform <b>' + b.from.platform.replace('Platform ', '') + '</b>' +
      '<span class="badge">' + esc(b.line.code) + '</span>',
    j.cancelledLeg === 1
      ? '<div class="dest note">' + esc(b.note) + '</div>'
      : '<div class="dest">' + esc(L ? b.line.full : b.line.name) + ' to ' + esc(b.line.headsign) + '</div>',
    '', b.line.code);

  /* The glance fact, in the masthead's standfirst slot: arrival time and
     minutes to go, exactly as docs/backlog/journey-focus/DESIGN.md names it. */
  var lede = 'Arrives ' + clock(endMs) +
    (j.cancelledLeg === 1 ? ' <del>' + clock(j.arrSchedMs) + '</del>' : '') +
    ' &nbsp;·&nbsp; ' + toGo + ' min to go';

  return '<div class="mast">' +
      '<div class="kicker"><span class="lbl">' + esc(opt.kicker || 'On this train') + '</span></div>' +
      '<h1>' + esc(L ? 'Rhodes Station' : 'Rhodes') + ' <em>→</em> ' +
        esc(L ? 'Bondi Junction Station' : 'Bondi Junction') + '</h1>' +
      '<div class="lede">' + lede + '</div>' +
      '<div class="tools"><button>Board</button><button>Unfocus</button></div>' +
      '<div class="rule"></div>' +
    '</div>' +
    '<div class="legs">' + legA + chg + legB + '</div>' +
    '<div class="tail"><div class="rule"></div><div class="line">' +
      '<span class="t">' + clock(endMs) + '</span>' +
      '<span class="n">' + esc(L ? b.to.station : b.to.name) + '</span>' +
      '<span class="lbl p">Platform ' + b.to.platform.replace('Platform ', '') + '</span>' +
    '</div></div>' +
    footerHtml();
}

/** The board, as shipped, for the surface-B comps to hang a strip on. */
function boardHtml(m, opt) {
  opt = opt || {};
  var rows = m.board.map(function (jr, i) { return boardRowHtml(jr, m.now, i === 0 && !opt.noFirst); });
  var cls = 'rows' + (rows.length < 6 ? ' sparse' : '');
  return '<div class="' + cls + '">' + rows.join('') + '</div>';
}

function boardMastHtml(inner) {
  return '<div class="mast">' +
    '<div class="kicker"><span class="lbl">Next departures</span></div>' +
    '<h1>Rhodes <em>→</em> Bondi Junction</h1>' +
    '<div class="tools"><button>Reverse</button><button>Edit</button></div>' +
    (inner || '') +
    '<div class="rule"></div>' +
  '</div>';
}
