### A

| State | Subtitle | Mark |
|---|---|---|
| Preference off | Location is not used | TURN ON |
| Permission not decided | Location needs permission | ALLOW |
| Permission denied | Location is blocked | OPEN SETTINGS |
| Permission granted | Nearby trips use location | TURN OFF |

*Optimises for the clearest state and next action.*

### B

| State | Subtitle | Mark |
|---|---|---|
| Preference off | Trips do not use location | USE LOCATION |
| Permission not decided | Trips need location permission | ALLOW |
| Permission denied | Trips cannot use location | OPEN SETTINGS |
| Permission granted | Nearby trips use location | STOP USING |

*Optimises for keeping the trip as the subject.*

### C

| State | Subtitle | Mark |
|---|---|---|
| Preference off | Location is off | TURN ON |
| Permission not decided | Permission needs a choice | CHOOSE |
| Permission denied | Blocked in Settings | SETTINGS |
| Permission granted | Chooses nearby trips | TURN OFF |

*Optimises for the fewest words.*

`ALLOW` names the intended outcome, although the tap first opens a choice. `SETTINGS` is a destination label rather than a verb; `CHOOSE` is a verb, but what is being chosen may be unclear.

I would ship A. It distinguishes every state without platform-specific copy, and each tap has a plain, predictable action.