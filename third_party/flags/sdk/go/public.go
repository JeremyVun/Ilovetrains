package flags

import core "github.com/JeremyVun/flags/server/pkg/flags"

// AllPublicFlags returns only evaluated public values from one atomic snapshot.
// Filtering before evaluation preserves the visibility boundary when a flag
// changes from public to private. No raw definition or targeting rule escapes.
// Local additive patch; see ../../README.md for vendoring provenance.
func (c *Client) AllPublicFlags(ec EvalContext) map[string]any {
	out := map[string]any{}
	snap, usable := c.usable()
	if !usable {
		return out
	}
	for i := range snap.Flags {
		flag := &snap.Flags[i]
		if !flag.Public {
			continue
		}
		detail := core.Evaluate(flag, ec, flag.Type)
		if detail.Reason != core.ReasonError {
			out[flag.Key] = detail.Value
		}
	}
	return out
}
