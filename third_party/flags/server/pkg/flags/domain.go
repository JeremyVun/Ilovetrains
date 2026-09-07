// Package flags is the SHARED CORE of the flagsd service: the single,
// cross-language evaluator together with the wire data types, the deterministic
// bucketing algorithm, and the content-hash versioner.
//
// This package is imported by BOTH the server (flagsd) and the Go SDK; there is
// no second copy of the evaluator anywhere in Go (DESIGN.md §2, §17). Non-Go
// SDKs reimplement against CONTRACT.md §4-5 and must reproduce the §5 bucketing
// test vectors exactly.
//
// CONTRACT.md is normative. Every type and constant here mirrors CONTRACT §2
// (wire shapes) and §4 (evaluation reasons / error kinds). This file contains
// TYPES + CONSTS ONLY — the behaviour lives in bucket.go, eval.go, version.go.
package flags

import "encoding/json"

// FlagType is the value type of a flag (CONTRACT §2.1 / §2.2).
// The requested type at evaluation time (determined by the SDK accessor used)
// must equal the flag's type, else evaluation returns ERROR/WRONG_TYPE.
type FlagType string

// Flag value types (CONTRACT §2.2).
const (
	TypeBoolean FlagType = "boolean"
	TypeString  FlagType = "string"
	TypeNumber  FlagType = "number"
	TypeJSON    FlagType = "json"
)

// Operator is a clause operator (CONTRACT §4.2).
type Operator string

// Clause operators (CONTRACT §4.2). All operators of the §4.2 table are listed.
const (
	OpEq          Operator = "eq"
	OpNeq         Operator = "neq"
	OpIn          Operator = "in"
	OpNotIn       Operator = "not_in"
	OpContains    Operator = "contains"
	OpNotContains Operator = "not_contains"
	OpStartsWith  Operator = "starts_with"
	OpEndsWith    Operator = "ends_with"
	OpGt          Operator = "gt"
	OpGte         Operator = "gte"
	OpLt          Operator = "lt"
	OpLte         Operator = "lte"
	OpExists      Operator = "exists"
	OpNotExists   Operator = "not_exists"
)

// Reason is an evaluation reason (CONTRACT §2.10 / §4.3).
type Reason = string

// Evaluation reasons (CONTRACT §4.3).
const (
	ReasonOff         Reason = "OFF"
	ReasonTargetMatch Reason = "TARGET_MATCH"
	ReasonRuleMatch   Reason = "RULE_MATCH"
	ReasonFallthrough Reason = "FALLTHROUGH"
	ReasonError       Reason = "ERROR"
)

// ErrorKind classifies an ERROR outcome (CONTRACT §2.10 / §4.3).
type ErrorKind = string

// Evaluation error kinds (CONTRACT §2.10 / §4.3); present only when reason==ERROR.
const (
	ErrFlagNotFound ErrorKind = "FLAG_NOT_FOUND"
	ErrWrongType    ErrorKind = "WRONG_TYPE"
	ErrMalformed    ErrorKind = "MALFORMED"
)

// Variation is a single named value a flag can resolve to (CONTRACT §2.1).
//
// Value is held as json.RawMessage so the STORED value round-trips byte-for-byte
// (no float reformatting, key reordering, etc.) through the server and over SSE.
// NOTE: that byte fidelity applies to storage/transport of Variation.Value — NOT
// to an SDK's evaluated JSONVariation output, which decodes the value to a generic
// any and re-marshals it, preserving structural (semantic) equality but not the
// exact bytes (object-key order / number formatting may differ). value's JSON type
// matches the flag's type: boolean -> true|false; string -> string; number ->
// JSON number; json -> any JSON value.
type Variation struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

// Outcome is the resolution target shared by Rule and Fallthrough: exactly one
// of Variation | Rollout MUST be present (CONTRACT §2.4, §2.6, §4.1 resolve()).
type Outcome struct {
	// Variation is a direct variation key. Empty when Rollout is set.
	Variation string `json:"variation,omitempty"`
	// Rollout is a weighted bucketing outcome. Nil when Variation is set.
	Rollout *Rollout `json:"rollout,omitempty"`
}

// Rule is an ordered, first-match-wins targeting rule (CONTRACT §2.4).
// A rule matches iff ALL of its clauses match (logical AND); empty clauses
// match. Exactly one of Variation | Rollout is the outcome (embedded Outcome).
type Rule struct {
	Clauses []Clause `json:"clauses"`
	Outcome          // embeds Variation / Rollout (CONTRACT §2.4)
}

// Clause is a single attribute predicate (CONTRACT §2.5).
//
// Values is the operand array; held as []json.RawMessage so heterogeneous JSON
// operands (numbers, strings, bools) round-trip exactly and are compared with
// the §4.2 numeric/string rules at eval time. The special attribute "key"
// addresses EvalContext.Key. Negation is expressed by explicit not_* operators.
type Clause struct {
	Attribute string            `json:"attribute"`
	Operator  Operator          `json:"operator"`
	Values    []json.RawMessage `json:"values"`
}

// Rollout is a weighted, deterministic bucketing outcome (CONTRACT §2.6, §5).
type Rollout struct {
	// BucketBy is the context attribute used as bucketing input. Default "key".
	BucketBy string `json:"bucket_by,omitempty"`
	// Seed salts the hash. Default = the flag key (independent rollouts per flag).
	Seed string `json:"seed,omitempty"`
	// Variations are walked in array order; total = Σ weight (CONTRACT §5).
	Variations []RolloutVariation `json:"variations"`
}

// RolloutVariation is one weighted slice of a Rollout (CONTRACT §2.6).
// Weight is a non-negative integer.
type RolloutVariation struct {
	Variation string `json:"variation"`
	Weight    int    `json:"weight"`
}

// Target is individual context-key targeting, evaluated before rules
// (CONTRACT §2.3). If EvalContext.Key is in Keys, the flag resolves to
// Variation with reason TARGET_MATCH.
type Target struct {
	Variation string   `json:"variation"`
	Keys      []string `json:"keys"`
}

// FlagConfig is the per-environment behaviour of a flag (CONTRACT §2.3).
// It is the document persisted in flag_configs and shipped (merged into Flag)
// over SSE. Whole-document on write (CONTRACT §3.4).
type FlagConfig struct {
	Key          string   `json:"key"`
	Environment  string   `json:"environment"`
	Enabled      bool     `json:"enabled"`
	OffVariation string   `json:"off_variation"`
	Targets      []Target `json:"targets"`
	Rules        []Rule   `json:"rules"`
	Fallthrough  Outcome  `json:"fallthrough"`
	// Version is the content hash (CONTRACT §4.4) of this (flag, environment)
	// config. Server-computed; SDKs treat it as opaque.
	Version string `json:"version,omitempty"`
}

// Flag is the MERGED per-environment flag object the evaluator takes
// (CONTRACT §2.2 definition + §2.3 config, merged per §2.8). It carries both
// the project-scoped definition (key, type, variations, description, public)
// and the per-environment config (enabled, off_variation, targets, rules,
// fallthrough). The evaluator consumes exactly this one struct.
type Flag struct {
	// Definition (CONTRACT §2.2).
	Key         string      `json:"key"`
	Type        FlagType    `json:"type"`
	Variations  []Variation `json:"variations"`
	Description string      `json:"description,omitempty"`
	Public      bool        `json:"public"`

	// Merged per-environment config (CONTRACT §2.3 / §2.8).
	Enabled      bool     `json:"enabled"`
	OffVariation string   `json:"off_variation"`
	Targets      []Target `json:"targets"`
	Rules        []Rule   `json:"rules"`
	Fallthrough  Outcome  `json:"fallthrough"`

	// Optional timestamps (CONTRACT §2.2). Not part of the content hash (§4.4).
	CreatedAt string `json:"created_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

// EvalContext is the single evaluation context (CONTRACT §2.7 / §8).
// Key is the stable unit of rollout and is also addressable as attribute "key".
// Attributes is a flat map; values may be string, number, bool, or array thereof.
type EvalContext struct {
	Key        string         `json:"key"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// FlagsSnapshot is the SDK-mode payload: the full, merged ruleset for a scope
// (CONTRACT §2.8). Flags are the merged per-environment Flag objects.
type FlagsSnapshot struct {
	Version     string `json:"version"`
	Project     string `json:"project"`
	Environment string `json:"environment"`
	Flags       []Flag `json:"flags"`
}

// (The server-side-evaluated EvaluatedFlags payload of the removed /v1/client
// plane is gone — CONTRACT §2.9 reserves that shape for project edge API
// services that return evaluated public-flag values only. No live code
// referenced it.)

// EvaluationDetail is the result of evaluating one flag (CONTRACT §2.10).
// Value is the resolved variation value (opaque any; nil on ERROR). RuleIndex is
// present only for RULE_MATCH; ErrorKind present only for ERROR.
type EvaluationDetail struct {
	Value     any    `json:"value"`
	Variation string `json:"variation"`
	Reason    Reason `json:"reason"`
	RuleIndex *int   `json:"rule_index,omitempty"`
	ErrorKind string `json:"error_kind,omitempty"`
}
