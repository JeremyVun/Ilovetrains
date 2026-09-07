package flags

import (
	"crypto/sha256"
	"encoding/binary"
	"strconv"
)

// Bucket implements the CROSS-LANGUAGE bucketing algorithm (CONTRACT §5)
// EXACTLY. It MUST be byte-identical across every SDK; this is the contract's
// load-bearing wall (CONTRACT §5, §10). It is preserved verbatim from both
// predecessor systems.
//
//	input  = stringValue( ctx[rollout.bucket_by] )   // bucket_by defaults to "key"
//	seed   = rollout.seed                             // defaults to flagKey
//	digest = SHA256( utf8( seed + ":" + input ) )     // ':' is U+003A (0x3A)
//	v      = uint64( bigEndian( digest[0:8] ) )        // first 8 bytes, big-endian
//	total  = Σ rollout.variations[i].weight            // integers >= 0
//	if total == 0: return rollout.variations[0].variation
//	b      = v % total                                 // 0 .. total-1
//	walk variations in array order, accumulating weight; first variation
//	where b < acc wins.
//
// Verified test vectors (CONTRACT §5):
//
//	checkout.v2 : user_123  -> v=7864620476314308649  (%100=49,  %100000=8649)
//	checkout.v2 : user_456  -> v=10263829706066319431 (%100=31,  %100000=19431)
//	banner.color: user_123  -> v=13572553560262970929 (%100=29,  %100000=70929)
//
// flagKey supplies the default seed when rollout.Seed is empty.
func Bucket(r Rollout, ctx EvalContext, flagKey string) string {
	// bucket_by defaults to "key" (CONTRACT §2.6, §5).
	bucketBy := r.BucketBy
	if bucketBy == "" {
		bucketBy = "key"
	}

	// seed defaults to the flag key (CONTRACT §2.6, §5).
	seed := r.Seed
	if seed == "" {
		seed = flagKey
	}

	// Read the bucketing input. The special attribute "key" addresses ctx.Key.
	input := stringValue(contextValue(ctx, bucketBy))

	// digest = SHA256( utf8( seed + ":" + input ) ); ':' is the single byte 0x3A.
	// Building the byte slice explicitly keeps the separator unambiguous.
	buf := make([]byte, 0, len(seed)+1+len(input))
	buf = append(buf, seed...)
	buf = append(buf, ':') // 0x3A
	buf = append(buf, input...)
	digest := sha256.Sum256(buf)

	// v = big-endian uint64 of the first 8 bytes.
	v := binary.BigEndian.Uint64(digest[0:8])

	// total = Σ weight.
	var total uint64
	for _, rv := range r.Variations {
		if rv.Weight > 0 {
			total += uint64(rv.Weight)
		}
	}

	// total == 0 -> first variation (CONTRACT §5). Guard the empty slice too so
	// we never panic (eval.go also guards malformed rollouts).
	if total == 0 {
		if len(r.Variations) == 0 {
			return ""
		}
		return r.Variations[0].Variation
	}

	b := v % total
	var acc uint64
	for _, rv := range r.Variations {
		if rv.Weight > 0 {
			acc += uint64(rv.Weight)
		}
		if b < acc {
			return rv.Variation
		}
	}

	// Unreachable when total > 0, but return the last variation defensively.
	return r.Variations[len(r.Variations)-1].Variation
}

// contextValue returns the context value addressed by attribute. The special
// attribute "key" addresses ctx.Key (CONTRACT §2.5, §2.7, §5).
func contextValue(ctx EvalContext, attribute string) any {
	if attribute == "key" {
		return ctx.Key
	}
	if ctx.Attributes == nil {
		return nil
	}
	return ctx.Attributes[attribute]
}

// stringValue converts a context value to its canonical string form for
// bucketing (CONTRACT §5):
//   - string  -> the string itself
//   - bool    -> "true" / "false"
//   - number  -> canonical decimal (integers without a decimal point; floats via
//     strconv.FormatFloat with 'g'/-1, the shortest round-trippable form)
//   - nil/other -> "" (bucketing on non-string keys SHOULD be avoided anyway)
//
// JSON numbers decoded into map[string]any arrive as float64; integral values
// are emitted without a fractional part so e.g. 34 -> "34", not "34.000000".
func stringValue(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return formatFloat(x)
	case float32:
		return formatFloat(float64(x))
	case int:
		return strconv.FormatInt(int64(x), 10)
	case int8:
		return strconv.FormatInt(int64(x), 10)
	case int16:
		return strconv.FormatInt(int64(x), 10)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int64:
		return strconv.FormatInt(x, 10)
	case uint:
		return strconv.FormatUint(uint64(x), 10)
	case uint8:
		return strconv.FormatUint(uint64(x), 10)
	case uint16:
		return strconv.FormatUint(uint64(x), 10)
	case uint32:
		return strconv.FormatUint(uint64(x), 10)
	case uint64:
		return strconv.FormatUint(x, 10)
	default:
		return ""
	}
}

// formatFloat renders a float64 in the canonical cross-language decimal form
// (CONTRACT §5): integral values without a decimal point (34.0 -> "34"),
// otherwise the shortest round-trippable PLAIN decimal — never scientific
// notation. This is the contract's load-bearing wall: every SDK MUST produce
// byte-identical bucket input, so the form is pinned to 'f' (fixed-point), which
// is trivially reproducible in any language (the .NET SDK mirrors it in
// Bucketing.FormatDouble). 'g' was previously used but diverges from other SDKs'
// shortest-form renderers on exponent casing and the scientific cutover.
func formatFloat(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}
