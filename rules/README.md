# AetherFlow Rule Library

A machine-readable collection of field-level validation and normalization rules for real-world business forms.

This directory is **data, not code**. Every `.md` file is a self-contained *rule pack* that a loader can parse without domain knowledge. Nothing here is executed at import time; rules are declarative so that a reviewer can diff them.

---

## 1. How a loader should parse this

Every rule pack follows one shape:

```
---
<YAML frontmatter: metadata>
---
# <Name> Rule Pack

## 1. Applicable Scope
## 2. Validation / Normalization Logic
## 3. Bad & Good Examples
## 4. Term / Enum Mapping
```

Parsing contract:

| Element | Meaning | Required |
| :--- | :--- | :--- |
| YAML frontmatter | Rule metadata. Keys are a closed set, see below. | yes |
| `# Title` | Human title. First `#` after frontmatter. | yes |
| `## 1.` | Scope: field / industry / region this applies to. | yes |
| `## 2.` | The logic. May contain a regex in a fenced block tagged `regex`, or pseudocode in a `text` block. | yes |
| `## 3.` | Two-column table `Bad \| Good \| Note`. Each row is one counter-example. | yes |
| `## 4.` | Two-column table `Non-standard form \| Standard value \| Note`. Omit the section entirely when there is no vocabulary. | no |

Frontmatter keys — no others are used:

```yaml
id:          # dotted, stable identifier, e.g. form.email
version:     # integer, bumped when the logic changes
scope:       # field | record | industry | region
field_types: # [] of: email phone date number currency text code identifier enum
regions:     # [] of ISO 3166-1 alpha-2, or [global]
industries:  # [] of: finance healthcare logistics retail automotive legal hr
severity:    # error (reject) | warning (flag, keep) | info (normalize silently)
direction:   # validate | normalize | both
evidence:    # high (published standard) | medium (vendor doc / convention) | low
source:      # [] of URLs or standard numbers actually consulted
```

`severity: info` means the rule is a *safe rewrite* and the UI may apply it without asking. `severity: error` means the value must be rejected or quarantined. Never silently drop a value that fails `error` — it goes to a reject file with the original bytes.

`evidence: low` is an explicit signal for the product: **do not auto-apply, ask the user**. The library prefers an honest "unknown" over a confident wrong answer.

---

## 2. Index

### form_fields/ — cross-industry common fields

| Pack | id | Covers |
| :--- | :--- | :--- |
| [email.md](form_fields/email.md) | `form.email` | Syntax, IDN, display-name form, case normalization, homograph risk |
| [phone.md](form_fields/phone.md) | `form.phone` | E.164, national trunk prefixes, separators, extension suffixes |
| [date-time.md](form_fields/date-time.md) | `form.date-time` | ISO 8601, ambiguous DD/MM vs MM/DD, Excel serials, timezone-less values |
| [numbers-and-text.md](form_fields/numbers-and-text.md) | `form.numbers-text` | Decimal comma, thousands separators, leading zeros, full-width chars, whitespace |
| [enums-and-currency.md](form_fields/enums-and-currency.md) | `form.enums-currency` | ISO 4217 amounts, boolean vocabulary, status/type enums, common dirty spellings |

### regions/ — region-mandated fields

| Pack | id | Covers |
| :--- | :--- | :--- |
| [cn.md](regions/cn.md) | `region.cn` | GB 11643 ID, GB 32100 USCC, mobile, postcode, invoice codes |
| [us.md](regions/us.md) | `region.us` | SSN, EIN, ZIP/ZIP+4, state abbreviations, NANP |
| [gb.md](regions/gb.md) | `region.gb` | NINO, postcode, UTR, Companies House number, sort code |
| [eu.md](regions/eu.md) | `region.eu` | VAT formats, IBAN by country, EU postcodes, GDPR-relevant identifiers |
| [international-codes.md](regions/international-codes.md) | `region.intl` | ISO 3166, ISO 4217, LEI, BIC, ISIN, M49, phone country codes |

### industries/ — industry-mandated fields

| Pack | id | Covers |
| :--- | :--- | :--- |
| [finance.md](industries/finance.md) | `industry.finance` | IBAN MOD-97, ISIN, CUSIP, BIC, SWIFT MT field formats |
| [healthcare.md](industries/healthcare.md) | `industry.healthcare` | ICD-10/ICD-10-CM, LOINC, NDC, CPT, HL7 v2 datatypes |
| [logistics.md](industries/logistics.md) | `industry.logistics` | ISO 6346 container, UN/LOCODE, IATA airport, SSCC/GLN |
| [retail-gs1.md](industries/retail-gs1.md) | `industry.retail` | GTIN-8/12/13/14, EAN/UPC check digits, GS1 Application Identifiers |
| [automotive-and-legal.md](industries/automotive-legal.md) | `industry.auto-legal` | VIN ISO 3779, plate formats, case numbers, party designations |

### terminology/ — terminology & enum standardization

| Pack | id | Covers |
| :--- | :--- | :--- |
| [healthcare-terms.md](terminology/healthcare-terms.md) | `term.healthcare` | Diagnosis name variants, laterality, negation phrasing |
| [finance-terms.md](terminology/finance-terms.md) | `term.finance` | Account-name aliases, counterparty suffixes, currency names |
| [legal-terms.md](terminology/legal-terms.md) | `term.legal` | Party designations, court names, cause-of-action vocabulary |
| [units-of-measure.md](terminology/units-of-measure.md) | `term.units` | Length/weight/volume conversions, unit spelling variants, UCUM |
| [country-and-region-names.md](terminology/country-and-region-names.md) | `term.geo` | Country name variants → ISO 3166, historical names, HK/MO/TW handling |

### quality/ — rule composition & record-level checks

| Pack | id | Covers |
| :--- | :--- | :--- |
| [field-level.md](quality/field-level.md) | `quality.field` | The six dimensions applied to a single cell |
| [record-level.md](quality/record-level.md) | `quality.record` | Cross-field logic, duplicates, referential integrity, temporal order |

---

## 3. Design decisions worth knowing

**Normalize never destroys the original.** Every `normalize` rule must keep the raw value alongside the normalized one. This library assumes the caller has a `raw` column; rules only describe the target form. The product now implements this: applying a rule-pack fix or Cleanse stores the original in a `__raw_<field>` column (earliest value wins) and the CSV export carries those `… (raw)` columns. Desensitized and Markdown exports intentionally omit raw, so PII is not re-exposed.

**Ambiguity is an error, not a guess.** `05/01/2024` is `warning` + `needs_user_input`, never auto-resolved. Guessing silently is how a tool loses trust on the first file.

**Regional rules are not applied by default.** A `region.cn` pack only runs when the column or workspace is declared as China. Applying every country's ID format to every column produces false positives and teaches users to ignore warnings. The engine enforces this in `selectActivePacks`: header inference only *suggests* a pack (surfaced in the Data Health Report as "Detected … enable?"), and a `region.*` / `industry.*` pack is mounted only when the user explicitly selects it or the workspace declares the region/industry — never auto-applied.

**Never infer identity or type from shape alone.** A value that merely *could* match a format must not be rewritten unless the column's declared semantics (name + region) make the match unambiguous. A bare 9-digit string is never assumed to be an SSN; a 16-digit string is never assumed to be a card number. Shape-only matches are flagged `ambiguous_identifier`, not normalized.

**Check digits are verified, not just pattern-matched.** Any pack with an algorithm states the modulus and weights explicitly, so an implementation can be tested against the sample rows in § 3.

**Evidence tier is a product feature.** `evidence: low` packs exist to be *reviewed*, not shipped. They are marked "needs human confirmation" in § 2 where a source could not be established.

---

## 4. Coverage gaps (honest list)

The following were considered and deliberately **not** written, because public evidence was insufficient to encode a rule safely:

| Area | Why not |
| :--- | :--- |
| National ID formats for most countries | Hundreds of schemes, many undocumented or revised yearly; a wrong checksum is worse than none. Only CN/US/GB are covered, each with a published algorithm. |
| Address parsing / postal address normalization | No reliable open standard; every country differs and libpostal-scale work is out of scope for a Markdown rule pack. |
| Bank account numbers outside SEPA | Routing/account structures are country- and bank-specific and not publicly verifiable. |
| Free-text medical diagnosis mapping to ICD-10 | Requires a licensed terminology (SNOMED CT / UMLS). Not encodable as a table; needs an external terminology service. |
| Personal-name normalization | Culturally unsafe to "fix". Only whitespace and honorific stripping are included; nothing about order or transliteration. |

Each is marked in the relevant pack as "insufficient evidence — manual enrichment suggested".

---

## 5. Versioning

`version` in frontmatter is per-pack. A loader should treat an unknown `id` as ignorable and an increased `version` as "re-read the pack". Deprecations are recorded in `CHANGELOG.md` at the repository root, not here.
