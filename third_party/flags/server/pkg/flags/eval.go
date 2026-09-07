package flags

import (
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"
)

// Evaluate evaluates one MERGED flag against a context and returns an
// EvaluationDetail, implementing CONTRACT §4.1 EXACTLY. It MUST NOT panic; any
// malformed flag/variation reference returns ERROR/MALFORMED (§4.1).
//
// Order (CONTRACT §4.1):
//  1. flag == nil               -> ERROR / FLAG_NOT_FOUND
//  2. requested != flag.Type    -> ERROR / WRONG_TYPE
//  3. !flag.Enabled             -> OFF (off_variation)
//  4. ctx.Key in target.Keys    -> TARGET_MATCH
//  5. rules in order, all clauses AND (empty clauses => match) -> RULE_MATCH (rule_index)
//  6. else                      -> FALLTHROUGH
//
// requested is the type implied by the SDK accessor used (BoolVariation =>
// TypeBoolean, etc.); a mismatch returns ERROR/WRONG_TYPE.
//
// Value is the raw JSON value of the chosen variation decoded to any (number ->
// float64, etc.), or nil on ERROR.
func Evaluate(flag *Flag, ctx EvalContext, requested FlagType) EvaluationDetail {
	// 1. Unknown flag (CONTRACT §4.1).
	if flag == nil {
		return errDetail(ErrFlagNotFound)
	}

	// 2. Type mismatch (CONTRACT §4.1, §4.3).
	if requested != flag.Type {
		return errDetail(ErrWrongType)
	}

	// 3. Kill switch (CONTRACT §4.1): disabled -> off_variation, reason OFF.
	if !flag.Enabled {
		return resolveVariation(flag, flag.OffVariation, ReasonOff, nil)
	}

	// 4. Individual targets, evaluated before rules (CONTRACT §2.3, §4.1).
	for _, t := range flag.Targets {
		if slices.Contains(t.Keys, ctx.Key) {
			return resolveVariation(flag, t.Variation, ReasonTargetMatch, nil)
		}
	}

	// 5. Rules in array order; first match wins (CONTRACT §2.4, §4.1).
	for i := range flag.Rules {
		if matchRule(flag.Rules[i], ctx) {
			idx := i
			return resolveOutcome(flag, flag.Rules[i].Outcome, ctx, ReasonRuleMatch, &idx)
		}
	}

	// 6. Fallthrough when no rule matched (CONTRACT §4.1).
	return resolveOutcome(flag, flag.Fallthrough, ctx, ReasonFallthrough, nil)
}

// errDetail builds an ERROR detail with the given kind. Value is nil and there
// is no variation/rule_index (CONTRACT §2.10, §4.1).
func errDetail(kind ErrorKind) EvaluationDetail {
	return EvaluationDetail{
		Value:     nil,
		Variation: "",
		Reason:    ReasonError,
		ErrorKind: kind,
	}
}

// resolveOutcome resolves a Rule/Fallthrough Outcome: a direct variation, or a
// rollout bucketed via §5 (CONTRACT §4.1 resolve()).
func resolveOutcome(flag *Flag, o Outcome, ctx EvalContext, reason Reason, idx *int) EvaluationDetail {
	if o.Rollout != nil {
		// Bucket per §5; the resulting variation key must exist on the flag.
		key := Bucket(*o.Rollout, ctx, flag.Key)
		return resolveVariation(flag, key, reason, idx)
	}
	return resolveVariation(flag, o.Variation, reason, idx)
}

// resolveVariation looks up a variation key on the flag and builds the detail.
// A missing/empty variation reference is a malformed flag -> ERROR/MALFORMED
// (CONTRACT §4.1). Never panics.
func resolveVariation(flag *Flag, key string, reason Reason, idx *int) EvaluationDetail {
	if key == "" {
		return errDetail(ErrMalformed)
	}
	for _, v := range flag.Variations {
		if v.Key == key {
			return EvaluationDetail{
				Value:     decodeValue(v.Value),
				Variation: key,
				Reason:    reason,
				RuleIndex: idx,
			}
		}
	}
	// Reference to a non-existent variation key (CONTRACT §4.1 malformed).
	return errDetail(ErrMalformed)
}

// decodeValue decodes a variation's raw JSON value into an opaque any
// (number -> float64, string -> string, bool, []any, map[string]any, null ->
// nil). On malformed JSON it returns nil rather than panicking; callers treat a
// resolved variation as authoritative for the reason/variation regardless.
func decodeValue(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil
	}
	return v
}

// matchRule reports whether a rule matches: ALL clauses must match (logical AND).
// Empty clauses => match (CONTRACT §4.1, §2.4).
func matchRule(rule Rule, ctx EvalContext) bool {
	for i := range rule.Clauses {
		if !matchClause(rule.Clauses[i], ctx) {
			return false
		}
	}
	return true
}

// matchClause evaluates one clause against the context per CONTRACT §4.2.
//
// Let a = the context value at clause.Attribute, V = clause.Values.
//   - If the attribute is ABSENT, every operator except not_exists is no-match
//     (exists is also no-match); not_exists matches.
//   - If a is an array, eq/in/contains match if ANY element satisfies the test.
//   - Numeric parsing is locale-independent float64.
func matchClause(c Clause, ctx EvalContext) bool {
	present := attributePresent(ctx, c.Attribute)

	// exists / not_exists depend only on presence (CONTRACT §4.2).
	switch c.Operator {
	case OpExists:
		return present
	case OpNotExists:
		return !present
	}

	// Absent attribute => no match for every other operator (CONTRACT §4.2).
	if !present {
		return false
	}

	a := contextValue(ctx, c.Attribute)
	return evalOperator(c.Operator, a, c.Values)
}

// attributePresent reports whether the attribute exists in the context. The
// special attribute "key" is always present (CONTRACT §2.5, §4.2); ctx.Key may
// be empty but the field exists.
func attributePresent(ctx EvalContext, attribute string) bool {
	if attribute == "key" {
		return true
	}
	if ctx.Attributes == nil {
		return false
	}
	_, ok := ctx.Attributes[attribute]
	return ok
}

// evalOperator applies a non-presence operator to the context value a and the
// operand list V (CONTRACT §4.2). a is known present here.
func evalOperator(op Operator, a any, V []json.RawMessage) bool {
	switch op {
	case OpEq:
		return anyEquals(a, operandAt(V, 0))
	case OpNeq:
		return !anyEquals(a, operandAt(V, 0))
	case OpIn:
		return anyIn(a, V)
	case OpNotIn:
		return !anyIn(a, V)
	case OpContains:
		return anyStringTest(a, operandAt(V, 0), strings.Contains)
	case OpNotContains:
		return !anyStringTest(a, operandAt(V, 0), strings.Contains)
	case OpStartsWith:
		return anyStringTest(a, operandAt(V, 0), strings.HasPrefix)
	case OpEndsWith:
		return anyStringTest(a, operandAt(V, 0), strings.HasSuffix)
	case OpGt:
		return numericCompare(a, operandAt(V, 0), func(x, y float64) bool { return x > y })
	case OpGte:
		return numericCompare(a, operandAt(V, 0), func(x, y float64) bool { return x >= y })
	case OpLt:
		return numericCompare(a, operandAt(V, 0), func(x, y float64) bool { return x < y })
	case OpLte:
		return numericCompare(a, operandAt(V, 0), func(x, y float64) bool { return x <= y })
	default:
		// Unknown operator => no match (forward-compatible; CONTRACT §1, §4.2).
		return false
	}
}

// operandAt returns V[i] as an opaque any (decoded), or nil if out of range.
func operandAt(V []json.RawMessage, i int) any {
	if i < 0 || i >= len(V) {
		return nil
	}
	return decodeValue(V[i])
}

// anyEquals implements eq's single-operand equality with §4.2 semantics:
// numeric compare if both parse as numbers, else string equality. If a is an
// array, match if ANY element equals the operand (set semantics, CONTRACT §4.2).
func anyEquals(a, operand any) bool {
	if arr, ok := a.([]any); ok {
		for _, el := range arr {
			if scalarEquals(el, operand) {
				return true
			}
		}
		return false
	}
	return scalarEquals(a, operand)
}

// scalarEquals compares two scalars: numeric compare if BOTH parse as float64,
// else string equality (CONTRACT §4.2).
func scalarEquals(a, b any) bool {
	if fa, oka := toFloat(a); oka {
		if fb, okb := toFloat(b); okb {
			return fa == fb
		}
	}
	return stringValue(a) == stringValue(b)
}

// anyIn implements in: a equals SOME element of V (same numeric/string rule). If
// a is an array, match if ANY of a's elements is in V (set semantics, §4.2).
func anyIn(a any, V []json.RawMessage) bool {
	if arr, ok := a.([]any); ok {
		for _, el := range arr {
			if scalarInValues(el, V) {
				return true
			}
		}
		return false
	}
	return scalarInValues(a, V)
}

// scalarInValues reports whether scalar a equals any decoded element of V.
func scalarInValues(a any, V []json.RawMessage) bool {
	for i := range V {
		if scalarEquals(a, decodeValue(V[i])) {
			return true
		}
	}
	return false
}

// anyStringTest applies a string predicate test(string(a), string(operand)).
// If a is an array, match if ANY element satisfies the test (set semantics for
// contains; applied uniformly for the string ops, CONTRACT §4.2). operand is
// rendered with stringValue too so numbers/bools compare by their canonical form.
func anyStringTest(a, operand any, test func(s, substr string) bool) bool {
	needle := stringValue(operand)
	if arr, ok := a.([]any); ok {
		for _, el := range arr {
			if test(stringValue(el), needle) {
				return true
			}
		}
		return false
	}
	return test(stringValue(a), needle)
}

// numericCompare applies a numeric comparison; FALSE if either side is
// non-numeric (CONTRACT §4.2 for gt/gte/lt/lte). Arrays are non-numeric => false.
func numericCompare(a, operand any, cmp func(x, y float64) bool) bool {
	fa, oka := toFloat(a)
	if !oka {
		return false
	}
	fb, okb := toFloat(operand)
	if !okb {
		return false
	}
	return cmp(fa, fb)
}

// toFloat parses a value as a locale-independent float64 (CONTRACT §4.2, §5).
// Returns ok=false for bools, nil, arrays, maps, and non-numeric strings.
// Numeric strings (e.g. "34") parse so a JSON-string operand can compare
// numerically against a numeric attribute.
func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int8:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case uint:
		return float64(x), true
	case uint8:
		return float64(x), true
	case uint16:
		return float64(x), true
	case uint32:
		return float64(x), true
	case uint64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	case string:
		// Match the .NET SDK's strict numeric-string parse (CONTRACT §4.2 / §8.1):
		// only a finite C-locale decimal. strconv.ParseFloat additionally accepts
		// digit-separator underscores ("1_000"), hex floats ("0x1p4"), and the
		// Inf/NaN word forms — none of which the .NET parser accepts — so reject
		// them here to keep numeric-string evaluation byte-identical across SDKs.
		if strings.ContainsAny(x, "_xXpP") {
			return 0, false
		}
		f, err := strconv.ParseFloat(x, 64)
		if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}
