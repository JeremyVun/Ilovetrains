/* ===========================================================================
   THE JOURNEY AS A TIME AXIS — one builder, both screens.

   ROUND 5 CORRECTION 2 (owner, binding): "take great care for the head and tail
   to be correctly positioned so that the transfer line gap shows accurately
   scaled to the user."

   The round-4/5 construction could not satisfy that sentence, and the reason is
   arithmetic, not taste. It laid the bar out with FLEX: the two platform
   numerals were `flex: none` siblings, so they consumed ~40px of the bar before
   any minute was drawn, and the runs then shared what was LEFT in the ratio
   27 : 7 : 10. The ratio between the three pieces was exact; their POSITIONS on
   the bar were not. Measured on the shipped board (measure.js, 390x844):

       bar 134px, drawn 58 / 20 / 15 / 20 / 22
       end of leg 1 drawn at 43.3% of the bar; true 27/44 = 61.4%  -> 24px out
       the gap drawn 11.2% of the bar;         true  7/44 = 15.9%  -> 30% narrow

   So the fix is to stop laying the bar out with flex and give it ONE COORDINATE
   SYSTEM: 0% is departure, 100% is arrival, and every mark on it — the leg
   fills, the dwell gap, the two platform numerals, the progress marker — is
   positioned as a percentage of the journey's own minutes. Nothing on the bar
   consumes time it does not represent.

   The numerals therefore stop DISPLACING the runs and start OVERLAYING them:
   the alight numeral's RIGHT edge sits on the end of leg 1 (it is the tail of
   the red line, which is the owner's round-4 wording) and the boarding
   numeral's LEFT edge sits on the start of leg 2 (the head of the blue one).
   What is left between them is the dwell, drawn at its true share. There is no
   minimum gap width: round 5 ruled that the true scale is what he wants to look
   at first.

   THE MARKER rides the same coordinate system, which is the whole reason this
   rewrite is worth its cost: "where am I in this trip" and "how long is the
   change" become the same measurement, and the gap is a place the marker can
   actually stand.

   Classic script, file:// origin: `SY_BAR` is a deliberate global.
   =========================================================================== */

/* spec = {
     legs:  [{ mins }]            one or two, in ride order
     dwell: minutes at the change (0 when there is no change)
     pIn / pOut: platform numerals, '' when the data does not have them (D3)
     tight: the connection is at risk — the gap goes coral
     caps:  draw the numerals at all
     prog:  null, or { at: 0..1 fraction of the journey elapsed,
                       phase: 'pre' | 'ride' | 'dwell' | 'done' }
   } */
function SY_BAR(s) {
  var legs = s.legs || [];
  var dwell = s.dwell || 0;
  var total = 0;
  for (var i = 0; i < legs.length; i++) total += legs[i].mins;
  total += dwell;
  if (!total) total = 1;

  var seg = function (cls, from, to) {
    return '<span class="' + cls + '" style="left:' + from + '%;width:' + (to - from) + '%"></span>';
  };

  /* The arithmetic the drawing claims to obey, carried in the DOM so measure.js
     can check the picture against it. Correction 2 is a geometry claim, and a
     geometry claim that only a screenshot can check is not checked. */
  var mins = [];
  for (var k = 0; k < legs.length; k++) mins.push(legs[k].mins);
  if (legs.length > 1) mins.splice(1, 0, dwell);

  var a = 100, b = 100;
  var out = '<span class="sy-spec" data-mins="' + mins.join('/') + '"></span>';
  if (legs.length < 2) {
    out += seg('sy-r a', 0, 100);
  } else {
    a = legs[0].mins / total * 100;
    b = a + dwell / total * 100;
    out += seg('sy-r a', 0, a)
      + seg('sy-g0' + (s.tight ? ' warn' : ''), a, b)
      + seg('sy-r b', b, 100);
  }

  /* THE TRAVELLED PART IS DIMMED, and that is not a new idea: the board's own
     law is "past rows are future rows, dimmed" (owner, round 4). This is the
     same law at the scale of one journey. The overlay sits UNDER the numerals
     on purpose — a dimmed fill carrying knocked-out ink loses contrast fast
     (M1's numeral measures 2.0:1 under a 45% dim, against the amendment's 3:1
     floor), and the platform you have to walk to is the instruction, which
     never dims. */
  if (s.prog && s.prog.at > 0) {
    out += '<span class="sy-dim" style="width:' + (s.prog.at * 100) + '%"></span>';
  }

  /* THE MARKER IS EMITTED BEFORE THE NUMERALS, and the order is the brief's hard
     constraint made mechanical: absolutely positioned siblings paint in source
     order, so the platform boxes paint OVER the marker's notch and a numeral can
     never be bitten into by it. The wedge still shows in every case, because it
     lives entirely above the numerals' own vertical extent (`--mkgap`). Looked
     at 4x on the `final` frame, where the marker rides straight through the
     boarding numeral's territory: with the order reversed the blue `5` had a
     chunk cut out of its right edge.

     Grey at rest, the line's colour in motion. `dwell` counts as motion: you are
     not moving but you are about to board something, and the marker wears the
     colour of the line it is about to board — a directions object points
     forward. */
  if (s.prog) {
    out += '<span class="sy-mk ' + s.prog.phase + '" style="left:' + (s.prog.at * 100) + '%"><i></i></span>';
  }

  var known = s.caps && s.pIn && s.pOut && legs.length > 1;
  if (known) {
    out += '<span class="sy-p a" style="right:' + (100 - a) + '%">' + s.pIn + '</span>'
      + '<span class="sy-p b" style="left:' + b + '%">' + s.pOut + '</span>';
  }
  return out;
}

/* The one case the coordinate system cannot draw honestly: a final leg shorter
   than the numeral that marks its head. Anchored at its true position the box
   would hang off the end of the bar and into the page margin — where shoot.js's
   overflow probe cannot see it, because that probe skips absolutely positioned
   elements. So it is pinned to the bar's end instead and MARKED, and the marking
   is what measure.js reports. Nothing in the repo's fixtures trips it (the
   shortest real leg is 10 of 44 minutes = 31px against a 28px two-digit box);
   it exists because the next fixture might. */
function SY_BAR_CLAMP(root) {
  (root || document).querySelectorAll('.sy-bar').forEach(function (bar) {
    var bb = bar.getBoundingClientRect();
    bar.querySelectorAll('.sy-p').forEach(function (p) {
      var r = p.getBoundingClientRect();
      if (r.right > bb.right + 0.5) {
        p.style.left = 'auto'; p.style.right = '0'; p.setAttribute('data-clamped', '1');
      } else if (r.left < bb.left - 0.5) {
        p.style.right = 'auto'; p.style.left = '0'; p.setAttribute('data-clamped', '1');
      }
    });
  });
}
