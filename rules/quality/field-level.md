---
id: quality.field
version: 1
scope: field
field_types: []
regions: [global]
industries: []
severity: warning
direction: validate
evidence: high
source: ["ISO 8000-2:2022 (vocabulary)", "ISO 8000-8 (measurement)", "DAMA UK six dimensions", "UK Government Data Quality Framework"]
---

# Field-Level Data Quality Rule Pack

## 1. Applicable Scope

Run a holistic health-check on a **single column**, producing a quantifiable quality verdict rather than row-by-row errors.

This is the productized form of the "import health-check": when a user drops in a file, what they see first is **how dirty this column is**, not a thousand red cells.

## 2. Validation / Normalization Logic

Adopts the six dimensions of ISO 8000 / DAMA, but **keeps only the parts that can be measured locally**, and explicitly flags the parts that cannot.

**2.1 Completeness**

```
non_empty_rate = non_empty_cells / total_rows
null detection: null, "", pure whitespace, "N/A", "NULL", "-", "无" (per workspace vocabulary)
```

| Threshold | Verdict | Suggested action |
| :--- | :--- | :--- |
| ≥ 99% | Pass | None |
| 95–99% | Slight missing | Flag, preserve on export |
| 80–95% | Obvious missing | Warn "this column is X% missing, may affect aggregation" |
| < 80% | Severe missing | Suggest dropping the column or filling with "Other / Unknown" |

**Key distinction**: a missing `required` field is an error; a missing `optional` field is merely a statistical fact, not an error. **Do not report empty optional fields as errors** — this is the classic reason users lose trust on first use.

**2.2 Uniqueness**

```
duplicate_rate = 1 − deduped_rows / total_rows
```

**Fully duplicated rows** and **duplicate primary-key columns** must be counted separately:

- Fully duplicated rows: usually export duplicates, typically safe to suggest deletion
- Primary-key duplicates: may be composite keys, may be real errors — **must let the user confirm which column is the primary key**

**2.3 Timeliness**

```
data_age = today − max_date_in_column
```

| Scenario | Threshold | Verdict |
| :--- | :--- | :--- |
| Transaction flow | > 7 days | May not be the latest export |
| Inventory snapshot | > 1 day | May be stale |
| Master data | > 30 days | Check the sync job |

**The value of this rule**: users often don't realize the file in hand was "exported last week." Stamping the data date on snapshots / reports is part of credibility.

**2.4 Validity**

```
compliance_rate = cells_passing_format_check / non_empty_cells
```

Format checks reference the `form_fields/`, `regions/`, and `industries/` packs.

**Important**: low validity for a column does **not** mean that column should be discarded. Often it means "the rule was applied to the wrong column" (e.g. applying US phone rules to Chinese numbers). So the first suggestion for low compliance is **check rule matching**; only then fix the data.

**2.5 Accuracy**

**Not measurable locally.** Accuracy means "this value agrees with the real-world object" and requires comparison against an authoritative source (e.g. a business registry, a banking system).

The rule pack takes a clear stance: **we do not claim to judge accuracy — only internal consistency and format validity.** Any claim that "the data is clean, therefore accurate" is wrong. This point should be written into the product UI help text.

**2.6 Consistency**

At the single-field level, consistency covers only two things:

- **Intra-column format consistency**: `2024-01-05` mixed with `05/01/2024` in the same column → format-mix rate
- **Unit consistency**: `kg` mixed with `lb` in the same column → unit-mix rate

**Mixing is a more dangerous state than "all wrong"**, because "all wrong" is easy to spot, while mixing creates the illusion of partial correctness.

**2.7 Output Structure**

Each column outputs one quality card:

```
{
  column, inferred_type, confidence,
  dimensions: {
    completeness: { value, level },
    uniqueness:   { value, level, note },
    timeliness:   { value, level },
    validity:     { value, level, rule_pack },
    consistency:  { value, level, mixed_formats }
  },
  suggestions: [ { action, expected_effect, severity } ]
}
```

**`confidence` is a required field**: when type-inference confidence is low (e.g. `01-02-03`), no strong suggestion may be given.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| Optional column 30% empty → report `error` | Report `warning` + statistical fact | Empty is not an error unless the field is declared required |
| Validity 20% → suggest dropping the whole column | First check whether the rule matched the wrong column | Low compliance is often a rule error |
| Claim "cleaned data is accurate" | Only say "format valid, internally consistent" | Accuracy needs an external source, not measurable locally |
| `2024-01-05` mixed with `05/01/2024` in one column → only report format error | Report `mixed_formats` and suggest unifying | Mixing is more dangerous than all-wrong |
| Judge "duplicate" without declaring a primary key | First ask which column is the primary key | Composite-key scenarios are extremely common |
| Type-inference confidence 40% but still give strong suggestion | Mark `low_confidence`, only hint | Guessing the wrong type triggers cascading mis-cleaning |
| Data dated 2023 but treated as latest | Mark `stale_data` + actual date | Timeliness is a hidden problem |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Locally measurable |
| :--- | :--- | :--- |
| Completeness | completeness | yes |
| Uniqueness | uniqueness | yes |
| Timeliness | timeliness | yes |
| Validity | validity | yes (format) |
| Accuracy | accuracy | **no** |
| Consistency | consistency | yes (internal) |

> **needs human confirmation**: the thresholds (99% / 95% / 80%) are industry experience values, **insufficient evidence — suggest adjusting per industry**: healthcare and finance demand higher completeness, while marketing data may be relaxed.
> **needs human confirmation**: Accuracy can do partial cross-checks when a local authoritative copy exists (e.g. another sheet in the same file), but this belongs to record-level rules — see the next pack.
