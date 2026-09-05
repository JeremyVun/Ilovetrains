# At an unsaved station

Priya opens the app at Burwood after an appointment. She has no saved trip
from Burwood, and her usual starting station is Rhodes.

The header shows Burwood → Rhodes and saves that pair under the ordinary
ten-trip LRU policy. Its row says `Just added` during the page load that
created it. No header receipt is needed for the new pair.

If she wants Bondi Junction instead, she adds that trip through the existing
new-trip sheet. The home fallback is an inference, and the other saved
trips remain visible. A new user with location permission and no saved
trips starts the sheet with the nearby station filled in.
