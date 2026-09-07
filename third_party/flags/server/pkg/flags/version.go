package flags

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

// Version computes the content-based version hash of an environment's flag set
// (CONTRACT §4.4):
//
//	version = hex( sha256( canonical(scope) ) )[0:16]
//
// canonical(scope) is a deterministic serialization of the environment's full
// flag set: flags sorted by key, each emitting
//
//	key｜type｜public｜enabled｜off_variation｜variations｜targets｜rules｜fallthrough
//
// with object keys sorted and arrays in document order. It is CONTENT-ONLY — NO
// timestamps or ids (CONTRACT §4.4; fixes perchd's timestamp-fragile hash,
// DESIGN.md §8). Identical content => identical version.
//
// "Content" is the EXACT stored bytes of the flag set: an omitted optional field
// and the same field set explicitly to its default are DISTINCT content and hash
// differently (e.g. a rollout with seed/bucket_by omitted vs. set to their §2.6/§5
// defaults). Both EVALUATE identically — bucketing applies the defaults — so the
// only effect is a one-time version bump on such a rewrite; the token stays opaque
// and no buckets reshuffle.
//
// IMPORTANT: this is computed ONLY by the server. SDKs (Go, .NET, any language)
// MUST treat version as an OPAQUE token for freshness, SSE Last-Event-ID, and
// optional management preconditions — and MUST NOT reproduce this
// canonicalization. The exact byte serialization here is server-internal and NOT
// part of the cross-language contract; only §5 bucketing is (CONTRACT §4.4).
func Version(snapshotFlags []Flag) string {
	canon := canonical(snapshotFlags)
	sum := sha256.Sum256([]byte(canon))
	return hex.EncodeToString(sum[:])[0:16]
}

// DefinitionAffectsVersion reports whether a definition-only edit changes any
// field that participates in Version's canonical flag content. Description and
// timestamps are intentionally excluded.
func DefinitionAffectsVersion(before, after Flag) bool {
	if before.Key != after.Key || before.Type != after.Type || before.Public != after.Public {
		return true
	}
	var b, a strings.Builder
	canonicalVariations(&b, before.Variations)
	canonicalVariations(&a, after.Variations)
	return b.String() != a.String()
}

// canonical builds the deterministic, content-only serialization described in
// CONTRACT §4.4. The exact bytes are server-internal (opaque to SDKs); only
// determinism and content-only-ness are contractual.
func canonical(flags []Flag) string {
	// Flags sorted by key (CONTRACT §4.4). Copy to avoid mutating the caller's
	// slice ordering.
	sorted := make([]Flag, len(flags))
	copy(sorted, flags)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Key < sorted[j].Key })

	var b strings.Builder
	for i := range sorted {
		canonicalFlag(&b, &sorted[i])
		b.WriteByte('\n') // flag separator
	}
	return b.String()
}

// canonicalFlag emits one flag's content fields in the §4.4 order:
// key｜type｜public｜enabled｜off_variation｜variations｜targets｜rules｜fallthrough.
// The full-width vertical bar U+FF5C (｜) is used as the field separator to match
// the spec notation; it is purely an internal serialization detail.
func canonicalFlag(b *strings.Builder, f *Flag) {
	const sep = "｜"
	b.WriteString(f.Key)
	b.WriteString(sep)
	b.WriteString(string(f.Type))
	b.WriteString(sep)
	b.WriteString(strconv.FormatBool(f.Public))
	b.WriteString(sep)
	b.WriteString(strconv.FormatBool(f.Enabled))
	b.WriteString(sep)
	b.WriteString(f.OffVariation)
	b.WriteString(sep)
	canonicalVariations(b, f.Variations)
	b.WriteString(sep)
	canonicalTargets(b, f.Targets)
	b.WriteString(sep)
	canonicalRules(b, f.Rules)
	b.WriteString(sep)
	canonicalOutcome(b, f.Fallthrough)
}

// canonicalVariations emits variations in document order (CONTRACT §4.4 arrays
// in document order). Each is key=value with value canonicalized so that
// logically-identical JSON content (object keys reordered, numbers in different
// literal forms, whitespace) yields identical bytes — "Identical content ⇒
// identical version" (CONTRACT §4.4).
func canonicalVariations(b *strings.Builder, vs []Variation) {
	b.WriteByte('[')
	for i := range vs {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(vs[i].Key)
		b.WriteByte('=')
		b.WriteString(canonicalJSON(vs[i].Value))
	}
	b.WriteByte(']')
}

// canonicalJSON returns a deterministic serialization of a json.RawMessage
// payload: object keys sorted lexicographically, numbers normalized to a single
// canonical decimal form, and whitespace removed (CONTRACT §4.4). If the bytes
// are not valid JSON it falls back to the raw bytes verbatim so the hash stays
// total and deterministic.
func canonicalJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return string(raw)
	}
	var out strings.Builder
	writeCanonicalValue(&out, v)
	return out.String()
}

// writeCanonicalValue recursively emits a decoded JSON value in canonical form.
func writeCanonicalValue(b *strings.Builder, v any) {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			kb, _ := json.Marshal(k)
			b.Write(kb)
			b.WriteByte(':')
			writeCanonicalValue(b, t[k])
		}
		b.WriteByte('}')
	case []any:
		b.WriteByte('[')
		for i := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			writeCanonicalValue(b, t[i])
		}
		b.WriteByte(']')
	case json.Number:
		b.WriteString(normalizeNumber(t.String()))
	case string:
		sb, _ := json.Marshal(t)
		b.Write(sb)
	case bool:
		b.WriteString(strconv.FormatBool(t))
	case nil:
		b.WriteString("null")
	default:
		// Should not happen with UseNumber decoding; fall back to JSON marshal.
		mb, _ := json.Marshal(t)
		b.Write(mb)
	}
}

// normalizeNumber collapses different literal forms of the same numeric value
// (e.g. "1", "1.0", "1e0") to one canonical decimal string so version stays
// stable under reformatting (CONTRACT §4.4). Falls back to the original literal
// if it cannot be parsed as a float.
func normalizeNumber(s string) string {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return s
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

// canonicalTargets emits targets in document order; each target's keys are
// emitted in document order too (CONTRACT §4.4).
func canonicalTargets(b *strings.Builder, ts []Target) {
	b.WriteByte('[')
	for i := range ts {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(ts[i].Variation)
		b.WriteByte('=')
		b.WriteByte('[')
		for j, k := range ts[i].Keys {
			if j > 0 {
				b.WriteByte(',')
			}
			b.WriteString(k)
		}
		b.WriteByte(']')
	}
	b.WriteByte(']')
}

// canonicalRules emits rules in document order; clauses in document order; each
// clause emits attribute, operator, and values in document order (CONTRACT §4.4).
// The per-clause field order here is fixed (object keys sorted): attribute,
// operator, values.
func canonicalRules(b *strings.Builder, rs []Rule) {
	b.WriteByte('[')
	for i := range rs {
		if i > 0 {
			b.WriteByte(';')
		}
		canonicalClauses(b, rs[i].Clauses)
		b.WriteByte('>')
		canonicalOutcome(b, rs[i].Outcome)
	}
	b.WriteByte(']')
}

// canonicalClauses emits a clause list in document order. Clause object keys are
// emitted in sorted order (attribute, operator, values) per §4.4.
func canonicalClauses(b *strings.Builder, cs []Clause) {
	b.WriteByte('{')
	for i := range cs {
		if i > 0 {
			b.WriteByte(',')
		}
		c := &cs[i]
		// object keys sorted: attribute, operator, values
		b.WriteString("attribute=")
		b.WriteString(c.Attribute)
		b.WriteString("|operator=")
		b.WriteString(string(c.Operator))
		b.WriteString("|values=[")
		for j := range c.Values {
			if j > 0 {
				b.WriteByte(',')
			}
			b.WriteString(canonicalJSON(c.Values[j])) // canonical operand, document order
		}
		b.WriteByte(']')
	}
	b.WriteByte('}')
}

// canonicalOutcome emits a variation/rollout outcome (CONTRACT §4.4). Exactly
// one of variation|rollout is set; both branches are deterministic.
func canonicalOutcome(b *strings.Builder, o Outcome) {
	if o.Rollout != nil {
		r := o.Rollout
		b.WriteString("rollout(bucket_by=")
		b.WriteString(r.BucketBy)
		b.WriteString(",seed=")
		b.WriteString(r.Seed)
		b.WriteString(",variations=[")
		for i := range r.Variations {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(r.Variations[i].Variation)
			b.WriteByte(':')
			b.WriteString(strconv.Itoa(r.Variations[i].Weight))
		}
		b.WriteString("])")
		return
	}
	b.WriteString("variation(")
	b.WriteString(o.Variation)
	b.WriteByte(')')
}
