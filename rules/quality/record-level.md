---
id: quality.record
version: 1
scope: record
field_types: []
regions: [global]
industries: []
severity: warning
direction: validate
evidence: medium
source: ["ISO 8000-130 (accuracy)", "ISO 8000-140 (completeness)", "DAMA consistency dimension", "business rule engine common patterns"]
---

# Record-Level Data Quality Rule Pack

## 1. Applicable Scope

Cross-field, cross-row logic validation: date ordering, amount totals, status transitions, foreign-key references, duplicate records.

**Division of labor with `field-level.md`**: the field level answers "how dirty is this column", the record level answers "does this row / this batch of data contradict itself".

Record-level rules **must be declared by the user** and cannot take effect automatically — because "which two fields should satisfy what relationship" is business knowledge, not format knowledge. The rule pack can only provide **reusable rule templates**.

## 2. Validation / Normalization Logic

**2.1 Cross-field Logic (Intra-row Consistency)**

| Rule template | Expression | Typical scenario |
| :--- | :--- | :--- |
| Date range | `start_date <= end_date` | contract period, billing period, lease |
| Date order | `birth_date < hire_date` | HR, insurance |
| Reasonable age | `0 <= age <= 120` | healthcare, insurance |
| Amount identity | `total = subtotal + tax - discount` | invoice, order |
| Line subtotal | `Σ(line_amount) = header_amount` | order header / lines |
| Quantity & unit price | `amount = qty × unit_price` (with tolerance) | procurement, sales |
| Ratio constraint | `0 <= discount_rate <= 1` | promotion, finance |
| Mutually exclusive fields | `A non-empty → B must be empty` | either-or scenario |
| Dependent fields | `status = 'shipped' → ship_date non-empty` | order state machine |
| Code & meaning | `country = 'US' → state ∈ US state set` | address |

**Float comparison must include tolerance**: compare amounts in the smallest integer unit; use `1e-9` tolerance for ratios. `0.1 + 0.2 != 0.3` is the most common false-positive source for this kind of rule.

**2.2 Duplicate Detection**

Split into three layers, **not to be conflated**:

| Layer | Criterion | Handling suggestion |
| :--- | :--- | :--- |
| Fully duplicated | all column values identical | usually export duplicates, can suggest deletion (keep one) |
| Primary-key duplicate | declared primary-key column has duplicates | error; need to confirm composite key vs real duplicate |
| Fuzzy duplicate | similar name + other fields close | **only hint, do not auto-merge** |

Examples of fuzzy-duplicate criteria (mostly for customer / supplier master data):

- After name normalization (strip suffix, trim spaces, lowercase) they are identical
- Name edit distance ≤ 2 and phone / tax ID identical
- Same tax ID or same document number → strong criterion

**Product stance: fuzzy duplicates are never auto-deleted.** Merging customer records is irreversible, and a wrong merge breaks historical transaction links.

**2.3 Referential Integrity**

```
foreign_key_value must exist in the referenced table's primary-key set
```

| Situation | Verdict |
| :--- | :--- |
| Foreign key points to a non-existent record | `orphan_record`, error |
| Foreign key empty and allowed empty | Pass |
| Foreign key empty but not allowed empty | error |
| Referenced table not imported | **cannot validate**, explicitly hint "missing related table", must not treat as pass |

**The last point is the baseline of product integrity**: we must not assume a reference is valid just because the other table is absent locally.

**2.4 Time Order & Status Flow**

```
status transitions must follow the legal transitions of the state machine
e.g.: pending → shipped → delivered is legal
      delivered → pending is illegal (unless a return flow exists)
timestamps must be monotonic: created_at <= updated_at <= closed_at
```

**2.5 Aggregation Consistency (Within Same File)**

| Rule | Note |
| :--- | :--- |
| Detail total = file-end total | common in financial exports |
| Group subtotal = sum of group details | |
| Row count = declared row count | file header declaration disagrees with actual |
| Row-count diff before/after dedup | report duplicate scale |

**2.6 Rule Declaration Format**

Record-level rules must be serializable, and carry tolerance and severity:

```
{
  id, type: 'cross_field' | 'duplicate' | 'referential' | 'temporal' | 'aggregate',
  fields: [...],
  expression,
  tolerance: { absolute?, relative? },
  severity: 'error' | 'warning' | 'info',
  message_template
}
```

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `end_date < start_date` report error | Correct (valid rule) | |
| `0.1 + 0.2 == 0.3` equality | With tolerance `\|a−b\| < 1e-9` | float trap |
| Amounts added with `Number` then compared | Use smallest integer unit (cents) | |
| All columns identical to count as duplicate | Layered: full / primary-key / fuzzy | primary-key dup more common |
| Fuzzy duplicate auto-merge | Only hint | merge is irreversible |
| Customer `ABC Ltd` and `ABC Limited` auto-delete one | Mark candidate, human confirm | may be two companies |
| Foreign-key table not imported → all pass | Hint "cannot validate" | never pretend to pass |
| `status='shipped'` but `ship_date` empty → ignore | error | status-dependent field |
| `delivered → cancelled` no return flow | Judge by state machine | |
| Detail total off by 0.01 → report error | Use tolerance (cents / milli) | rounding diff is not an error |
| One row `country=US` but `state=ON` (Ontario, Canada) | error | code & meaning mismatch |
| Primary-key dup but actually composite key | First confirm primary-key definition | common misjudgment |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Typical fields |
| :--- | :--- | :--- |
| `cross_field` | cross_field | dates, amounts, status |
| `duplicate` | duplicate | primary key, name, tax ID |
| `referential` | referential | foreign key |
| `temporal` | temporal | timestamp, status |
| `aggregate` | aggregate | totals, subtotals |
| `uniqueness` | uniqueness | primary key |
| `cardinality` | cardinality | one-to-many relationship |

> **needs human confirmation**: record-level rules are essentially business knowledge, **insufficient evidence — manual enrichment suggested** — this pack provides templates and judgment principles, not any industry-specific mandatory rules.
> **needs human confirmation**: the legal transition table of the state machine must be defined per business system, and cannot be reverse-engineered from data (historical data may itself be wrong).
