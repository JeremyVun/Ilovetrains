package flags

import (
	"encoding/json"
	"errors"
	"fmt"
)

// This file holds the pure, transport-agnostic domain validators for the §2/§3.7
// flag invariants. They live in the shared core so EVERY write path enforces the
// SAME rules: the API create/PATCH handlers (internal/api) and the import path
// (internal/store), which cannot import internal/api. Returning plain errors (not
// HTTP envelopes) keeps them dependency-free; callers map them to their own
// status codes.

// ErrVariationInvalidValueJSON marks a variation whose stored value is not valid
// JSON (distinct from a value of the wrong type), so an HTTP caller can map it to
// 400 rather than 422.
var ErrVariationInvalidValueJSON = errors.New("variation has invalid JSON value")

// ValidateVariationValue verifies a variation's JSON value matches the flag type
// (CONTRACT §2.1): boolean→bool, string→string, number→JSON number, json→any.
func ValidateVariationValue(typ FlagType, v Variation) error {
	if len(v.Value) == 0 {
		return fmt.Errorf("variation %s has no value", v.Key)
	}
	var decoded any
	if err := json.Unmarshal(v.Value, &decoded); err != nil {
		return fmt.Errorf("variation %s: %w", v.Key, ErrVariationInvalidValueJSON)
	}
	switch typ {
	case TypeBoolean:
		if _, ok := decoded.(bool); !ok {
			return fmt.Errorf("variation %s value must be a boolean", v.Key)
		}
	case TypeString:
		if _, ok := decoded.(string); !ok {
			return fmt.Errorf("variation %s value must be a string", v.Key)
		}
	case TypeNumber:
		if _, ok := decoded.(float64); !ok {
			return fmt.Errorf("variation %s value must be a number", v.Key)
		}
	case TypeJSON:
		// any JSON value is acceptable.
	}
	return nil
}

// ValidateBooleanVariations enforces the boolean invariant: exactly the two
// variations off(false) and on(true) (CONTRACT §2.2, §3.7).
func ValidateBooleanVariations(vs []Variation) error {
	if len(vs) != 2 {
		return errors.New("boolean flag must have exactly two variations: off(false), on(true)")
	}
	want := map[string]bool{"off": false, "on": true}
	for _, v := range vs {
		exp, ok := want[v.Key]
		if !ok {
			return errors.New("boolean flag variations must be keyed off and on")
		}
		var b bool
		if err := json.Unmarshal(v.Value, &b); err != nil || b != exp {
			return fmt.Errorf("boolean variation %q must have value %v", v.Key, exp)
		}
	}
	return nil
}

// CanonicalizeVariations returns the write-boundary canonical variation order.
// Boolean flags are always stored as off(false), on(true), regardless of the
// order supplied by the caller. Other flag types keep caller order.
func CanonicalizeVariations(typ FlagType, vs []Variation) []Variation {
	if typ != TypeBoolean {
		return vs
	}
	var off, on Variation
	for _, v := range vs {
		switch v.Key {
		case "off":
			off = v
		case "on":
			on = v
		}
	}
	return []Variation{off, on}
}

// DefaultVariationKey returns the variation used by default configs and empty
// off_variation writes. Boolean flags are pinned to "off" so a disabled boolean
// flag can never serve true because of caller-supplied variation order.
func DefaultVariationKey(typ FlagType, vs []Variation) string {
	if typ == TypeBoolean {
		for _, v := range vs {
			if v.Key == "off" {
				return "off"
			}
		}
	}
	if len(vs) == 0 {
		return ""
	}
	return vs[0].Key
}

// ValidOperator reports whether op is a recognized clause operator (CONTRACT §4.2).
// Unknown operators evaluate to "no match" at runtime, so an unvalidated bad
// operator silently disables a rule — every write path MUST reject it.
func ValidOperator(op Operator) bool {
	switch op {
	case OpEq, OpNeq, OpIn, OpNotIn,
		OpContains, OpNotContains, OpStartsWith, OpEndsWith,
		OpGt, OpGte, OpLt, OpLte,
		OpExists, OpNotExists:
		return true
	default:
		return false
	}
}

// ValidateRuleOperators checks every clause operator across rules is recognized
// (CONTRACT §4.2). Returns the first offending rule/clause.
func ValidateRuleOperators(rules []Rule) error {
	for i := range rules {
		for j := range rules[i].Clauses {
			if !ValidOperator(rules[i].Clauses[j].Operator) {
				return fmt.Errorf("rule[%d].clauses[%d] has unknown operator: %s", i, j, rules[i].Clauses[j].Operator)
			}
		}
	}
	return nil
}

// ValidateRuleJSON rejects the removed clause field "negate": true before JSON
// is decoded into Rule structs, where unknown fields would otherwise be ignored.
// A false value is accepted and stripped on write because it has no effect.
func ValidateRuleJSON(raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var rules []struct {
		Clauses []map[string]json.RawMessage `json:"clauses"`
	}
	if err := json.Unmarshal(raw, &rules); err != nil {
		return err
	}
	for i := range rules {
		for j := range rules[i].Clauses {
			v, ok := rules[i].Clauses[j]["negate"]
			if !ok {
				continue
			}
			var b bool
			if err := json.Unmarshal(v, &b); err != nil {
				return fmt.Errorf("rule[%d].clauses[%d].negate must be a boolean", i, j)
			}
			if b {
				return fmt.Errorf("rule[%d].clauses[%d].negate is not supported; use not_* operators", i, j)
			}
		}
	}
	return nil
}

// ValidateRolloutBucketBy enforces the v1 freeze: bucket_by may be omitted or
// "key" only. The field stays on the wire for forward compatibility, but
// alternate attributes are rejected at write boundaries.
func ValidateRolloutBucketBy(field string, o Outcome) error {
	if o.Rollout == nil {
		return nil
	}
	if o.Rollout.BucketBy != "" && o.Rollout.BucketBy != "key" {
		return fmt.Errorf("%s rollout bucket_by must be \"key\" when set", field)
	}
	return nil
}

// ValidateRolloutPercentTotal enforces the product-level rollout policy:
// persisted rollout weights are integer percentages and must sum to exactly 100.
// Bucket() still implements the defensive §5 algorithm for arbitrary totals so
// SDKs stay byte-identical, but flagsd write paths reject non-percent documents.
func ValidateRolloutPercentTotal(field string, o Outcome) error {
	if o.Rollout == nil {
		return nil
	}
	total := 0
	for _, rv := range o.Rollout.Variations {
		total += rv.Weight
	}
	if total != 100 {
		return fmt.Errorf("%s rollout weights must sum to exactly 100 (got %d)", field, total)
	}
	return nil
}

// OutcomeRefErrorKind classifies outcome-reference validation failures for
// transports that distinguish malformed documents from semantic 422s.
type OutcomeRefErrorKind int

const (
	OutcomeRefUnprocessable OutcomeRefErrorKind = iota
	OutcomeRefMalformed
)

// OutcomeRefError is returned by ValidateOutcomeRefs.
type OutcomeRefError struct {
	Kind    OutcomeRefErrorKind
	Message string
}

func (e *OutcomeRefError) Error() string { return e.Message }

// IsMalformedOutcomeRef reports whether err should be treated as a malformed
// outcome document rather than an unprocessable semantic reference error.
func IsMalformedOutcomeRef(err error) bool {
	var e *OutcomeRefError
	return errors.As(err, &e) && e.Kind == OutcomeRefMalformed
}

func outcomeRefError(kind OutcomeRefErrorKind, msg string) error {
	return &OutcomeRefError{Kind: kind, Message: msg}
}

// ValidateOutcomeRefs validates a single outcome (variation or rollout entries)
// against the known variation set (CONTRACT §3.7).
func ValidateOutcomeRefs(field string, o Outcome, known map[string]bool) error {
	if err := ValidateRolloutBucketBy(field, o); err != nil {
		return outcomeRefError(OutcomeRefUnprocessable, err.Error())
	}
	if o.Rollout != nil {
		if len(o.Rollout.Variations) == 0 {
			return outcomeRefError(OutcomeRefMalformed, field+" rollout has no variations")
		}
		for _, rv := range o.Rollout.Variations {
			if rv.Weight < 0 {
				return outcomeRefError(OutcomeRefMalformed, field+" rollout weight must be non-negative")
			}
			if !known[rv.Variation] {
				return outcomeRefError(OutcomeRefUnprocessable, field+" rollout references unknown variation: "+rv.Variation)
			}
		}
		if err := ValidateRolloutPercentTotal(field, o); err != nil {
			return outcomeRefError(OutcomeRefUnprocessable, err.Error())
		}
		return nil
	}
	if o.Variation == "" {
		return outcomeRefError(OutcomeRefUnprocessable, field+" must specify a variation or rollout")
	}
	if !known[o.Variation] {
		return outcomeRefError(OutcomeRefUnprocessable, field+" references unknown variation: "+o.Variation)
	}
	return nil
}
