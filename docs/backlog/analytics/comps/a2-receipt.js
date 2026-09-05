/* No strip at all: the header's own receipt slot asks, and the action sits on
   the same line. Nothing below the heavy rule moves. */
renderHome({
  focused: true,
  strip: {
    slot: 'receipt',
    html: function (m) {
      return '<div class="rec-line"><span class="q">Is this trip to ' + m.to + '?</span>'
        + '<button data-act="change-dest" data-tap>Change</button></div>';
    }
  }
});
