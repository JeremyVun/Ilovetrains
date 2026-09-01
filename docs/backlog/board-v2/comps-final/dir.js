/* ===========================================================================
   DIRECTIONS — the state machine behind the header.

   Owner: "the focus should really be like google maps directions. based on the
   trip and the current time, it'll tell you where to go next."

   PROMOTE, DON'T REBUILD. `web/js/focus.js` already computes departed / riding /
   arrived, the next change with its platform and minutes, the tight-change flag
   and cancellation, and it already orders its third line as *what is wrong ->
   what you must do -> where you are going*. Everything below is that logic with
   two things added that the strip never needed:

     1. a POSITION — where the person is in the journey, as a fraction of its
        own minutes, so the marker has somewhere to be;
     2. a FIGURE THAT CHANGES REFERENT — minutes to departure before you leave,
        minutes to the connection while you ride toward it, minutes to arrival
        after it. The board's figure always answers "when does it leave"; a
        directions object has to answer "how long until the next thing I do".
        The word under the figure says which, out of the vocabulary STYLES
        already binds (`TO CHANGE`, `TO GO`, `AGO`, `CANCELLED`).

   SENTENCES ABOUT THE TRAIN ARE SAFE; SENTENCES ABOUT THE PERSON ARE INFERRED
   (owner). So the instruction line is an instruction wherever that costs
   nothing — `Off at Town Hall · Platform 3`, never `you are on board` — and the
   one place the person is asserted is arrival, where `focus.js` already flips
   `arrives` / `you arrive` / `you arrived`.

   Position comes from timetable + live estimates and from nothing else. The app
   holds a one-shot location fix (client-storage.md) and there is no continuous
   tracking anywhere in this design; the marker is a clock reading, not a GPS
   reading, and the only state that leans on the fix at all is `leave`.

   Classic script, file:// origin: `DIR` is a deliberate global.
   =========================================================================== */

function DIR(j, now, opt) {
  opt = opt || {};
  var hm = function (t) { var p = String(t).split(':'); return +p[0] * 60 + +p[1]; };
  var clock = function (m) {
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };

  var t = hm(now), dep = hm(j.dep), arr = hm(j.arr);
  var total = arr - dep; if (total <= 0) total += 1440;
  var two = j.legs.length > 1 && j.chg;
  var leg1End = two ? dep + j.legs[0].mins : arr;
  var leg2Start = two ? leg1End + j.chg.mins : arr;

  var d = {
    j: j, total: total, warn: false, evidence: '', receipt: '',
    figure: '', prov: '', instruction: '', at: 0, phase: 'pre'
  };

  /* CANCELLED NEVER SILENTLY SKIPS (STYLES ruling A, verbatim idiom). The header
     answers with the next train — that is what the screen is for — and says in
     the same breath which one it dropped. */
  if (j.cancelled) {
    d.phase = 'pre'; d.at = 0;
    d.figure = String(dep - t); d.prov = '';
    d.instruction = j.cancelled + ' CANCELLED · NEXT TRAIN';
    d.warn = true; d.note = true;
    return d;
  }

  if (t < dep) {
    d.phase = 'pre'; d.at = 0;
    d.figure = String(dep - t); d.prov = '';
    /* The only state that spends the location fix. It is an instruction, not a
       claim about where the person is, and the fix that justifies it is printed
       underneath — the receipt in proportion to the leap. */
    d.instruction = opt.leave ? 'Leave now for Platform ' + j.plat : (j.head || 'via ' + (two ? j.chg.at : j.to));
    /* `act` is the difference between an INSTRUCTION and the headsign, and the
       header sets the two in different weights of ink: the sentence you are
       meant to act on is the page's ink, the sentence that merely names the
       train is secondary. Before you have anything to do, the header has nothing
       to shout. */
    d.act = !!opt.leave;
    if (opt.leave) d.evidence = 'You’re ' + opt.leave + ' from ' + j.from + '.';
  } else if (t >= arr) {
    d.phase = 'done'; d.at = 1;
    d.figure = String(t - arr); d.prov = 'AGO';
    d.instruction = 'You arrived at ' + j.to + '.'; d.act = true;
  } else {
    d.at = (t - dep) / total; d.act = true;
    if (two && t < leg1End) {
      d.phase = 'ride';
      /* THE FIGURE COUNTS TO THE NEXT THING YOU MUST DO, and riding toward a
         change that is getting OFF, not the connecting train's departure. The
         first pass counted to 09:58 and printed 25 while the instruction said
         `Off at Town Hall`; you stand up at 09:51, so the number under the
         instruction has to be 18. In the dwell the next action is boarding, and
         the figure counts to that. One rule, two referents, and the word under
         it says which. */
      d.figure = String(leg1End - t); d.prov = 'TO CHANGE';
      d.instruction = 'Off at ' + j.chg.at + (j.chg.pIn ? ' · Platform ' + j.chg.pIn : '');
    } else if (two && t < leg2Start) {
      d.phase = 'dwell';
      d.figure = String(leg2Start - t); d.prov = 'TO CHANGE';
      d.instruction = (j.chg.pOut ? 'Platform ' + j.chg.pOut + ' · ' : '')
        + clock(leg2Start) + ' to ' + j.to;
    } else {
      d.phase = two ? 'ride2' : 'ride';
      d.figure = String(arr - t); d.prov = 'TO GO';
      d.instruction = 'Off at ' + j.to + (j.arrPlat ? ' · Platform ' + j.arrPlat : '');
    }
  }

  /* THE CONNECTION AT RISK. STYLES binds A3's treatment: the change figure goes
     coral, both times are shown, `PRINTED CHANGE WAS 7 MIN`, no prediction. In a
     header with one instruction line the warning REPLACES the instruction — the
     precedent is the cancelled lead, which does exactly that on the board — and
     the printed-change evidence goes in the line under it, which is the slot
     this design already uses for "why the app is saying this". */
  if (j.tight && (d.phase === 'pre' || d.phase === 'ride' || d.phase === 'dwell')) {
    d.warn = true;
    d.instruction = 'Tight change · ' + j.chg.mins + ' min · Platform ' + j.chg.pOut;
    if (j.chgWas) d.evidence = 'Printed change was ' + j.chgWas + ' min.';
  }
  return d;
}

/* The bar spec for a journey, with the marker where DIR put it. One function so
   the home header, the board's focus strip and (one day) the journey detail view
   cannot disagree about the same object. */
function DIR_BAR(d, caps) {
  var j = d.j;
  var two = j.legs.length > 1 && j.chg;
  return {
    legs: two ? [{ mins: j.legs[0].mins }, { mins: j.legs[1].mins }] : [{ mins: d.total }],
    dwell: two ? j.chg.mins : 0,
    pIn: two ? j.chg.pIn : '', pOut: two ? j.chg.pOut : '',
    tight: !!j.tight, caps: caps !== false,
    prog: { at: d.at, phase: d.phase }
  };
}
