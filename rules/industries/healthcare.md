---
id: industry.healthcare
version: 1
scope: industry
field_types: [identifier, code, text, date]
regions: [global]
industries: [healthcare]
severity: warning
direction: both
evidence: medium
source: ["WHO ICD-10", "CMS ICD-10-CM", "LOINC", "FDA NDC", "AMA CPT", "HL7 v2.5.1"]
---

# Healthcare Industry Rule Pack

## 1. Applicable Scope

Coded fields in medical-record exports, clinical research data, insurance claims, drug catalogs, and lab-result forms.

**Important disclaimer:** This pack only performs **format and structure validation** and does not make clinical-reasonableness judgments (e.g. "does this diagnosis match this medication"). Any judgment involving clinical decisions must be made by qualified personnel or a professional system. If such rules are wrong, the consequences are worse than dirty data.

## 2. Validation / Normalization Logic

**2.1 ICD-10 (WHO version)**

```regex
^[A-Z]\d{2}(\.\d{1,2})?$
```

Structure: `1 section letter (A–Z; 21 of A–Z are actually used) + 2 digits + optional decimal + 1–2 digit subdivision`

- Trailing **0 after the decimal should be avoided**: `A01.10` should be written as `A01.1`
- WHO version allows at most 2 decimal places
- Section letter `U` is for special use (e.g. COVID-19's `U07.1`); do not treat it as invalid

**2.2 ICD-10-CM (US Clinical Modification)**

```regex
^[A-Z]\d{2,3}(\.\d{1,4})?$
```

- Can be longer than the WHO version (up to 7 characters, 4 decimal places)
- **Codes like `A01` that do not reach a leaf node are not allowed as a final diagnosis in ICD-10-CM** (they must reach the finest granularity), but this is an encoding convention rather than a format issue, so flag `warning` rather than `error`
- The 7th character often denotes encounter (type of visit); its meaning depends on context

**2.3 ICD-9-CM (legacy system)**

```regex
^(\d{3}(\.\d{1,2})?|[VE]\d{2,4}(\.\d{1,2})?)$
```

- Pure digits: `001`–`999`
- `V` prefix: Supplementary classification
- `E` prefix: External causes
- The US retired it in 2015, but legacy data and some countries still use it

**2.4 LOINC (lab test item code)**

```regex
^\d{4,5}-\d$
```

Check digit algorithm (mod 10, **not Luhn**):

```
1. Take the 4 or 5 digits before the hyphen
2. Starting from the rightmost digit, moving left, alternate weights 2, 1, 2, 1 ...
3. If a product ≥ 10, add the two digits (i.e. subtract 9)
4. After summing, check digit = (10 − sum mod 10) mod 10
5. The check digit must equal the 1 digit after the hyphen
```

**Common pitfall:** This is "right-to-left, starting weight 2", unlike Luhn (right-to-left, every other digit ×2); the bank-card implementation cannot be reused.

**2.5 NDC (US drug code)**

```regex
^(\d{4}-\d{4}-\d{2}|\d{5}-\d{3}-\d{2}|\d{5}-\d{4}-\d{1})$
```

Three legal segmentations: `4-4-2`, `5-3-2`, `5-4-1`, 10 digits total. **No check digit**; only structural validation. The same drug is one code across the three formats, so **it must be normalized to an 11-digit hyphen-free form before comparison**.

Normalization: `labeler(4/5) + product(4/3/4) + package(2/2/1)` → pad to the standard `5-4-2` NDC11.

**2.6 CPT (US procedure code)**

```regex
^(\d{5}|\d{4}[A-Z]|[A-Z]\d{4})$
```

- Category I: 5 digits
- Category II: 4 digits + `F`
- Category III: `0` + 4 digits + `T` (the new version is pure 5 digits)
- **CPT is AMA licensed content; this library does not provide the code table**, only the format

**2.7 HL7 v2 Data Types**

| Type | Format | Example |
| :--- | :--- | :--- |
| `TS` (timestamp) | `YYYYMMDDHHMMSS±ZZZZ` | `20240105103000+0800` |
| `DT` (date) | `YYYYMMDD` | `20240105` |
| `NM` (numeric) | digits, may include decimals | `12.5` |
| `SI` (serial) | pure digits | `1` |
| `CX` (patient identifier) | `ID^^^AssigningAuthority^Type` | multi-component, separated by `^` |

**HL7 v2 dates have no separators** (`20240105`, not `2024-01-05`), and **may be precise only to year or month** (`2024`, `202401` are both valid). A strict ISO 8601 regex would misjudge them.

**2.8 Sex / Administrative Sex**

| Code | Meaning | Note |
| :--- | :--- | :--- |
| `M` | Male | |
| `F` | Female | |
| `U` / `UNK` | Unknown | |
| `O` | Other | |
| HL7 `F`/`M`/`U` | administrative sex | differs from the "gender identity" field; do not merge |

**Do not** collapse free-text sex (`男`, `女性`, `male`, `MALE`, `M `) directly into a boolean; unknown must be preserved as unknown.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `A01.10` | `A01.1` | trailing 0 is redundant |
| `A1` | `A01` | numeric part must be 2 digits |
| `A01.123 (WHO)` | reject or interpret as CM | WHO version allows at most 2 decimal places |
| `U07.1` | valid | special-purpose section |
| `1234-5` | `1234-5` valid (LOINC) | check digit requires algorithm verification |
| `1234-6` | reject | check digit error |
| `00000-0` | reject | check digit error |
| `12345-678-90` | `12345-0678-90` | NDC normalized to 5-4-2 |
| `1234567890` | `12345-6789-0` | hyphen-free NDC requires segment inference by length |
| `99213` | valid | CPT Category I |
| `9921F` | valid | Category II |
| `20240105103000+0800` | valid (HL7 TS) | differs from ISO 8601 |
| `2024-01-05 (HL7 field)` | `20240105` | HL7 has no separators |
| `2024 (HL7 DT)` | valid (year only) | partial precision is valid |
| `男 ` / `MALE` / `m` | `M` | normalize |
| `未知` / `不详` | `U` | |
| `1 (as gender)` | reject or mapping needs confirmation | numeric encoding has different meanings across systems |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `ICD10`, `ICD 10`, `国际疾病分类` | `icd10` | |
| `ICD-10-CM`, `CM 码` | `icd10cm` | distinguish from WHO version |
| `LOINC`, `检验码` | `loinc` | |
| `NDC`, `药品码` | `ndc` | note it differs from ATC |
| `CPT`, `操作码` | `cpt` | |
| `诊断`, `主诊断`, `入院诊断`, `出院诊断` | different semantics; do not merge | principal diagnosis vs secondary diagnosis has clinical and billing implications |
| `男`, `男性`, `male`, `MALE`, `M ` | `M` | |
| `女`, `女性`, `female`, `FEMALE`, `F ` | `F` | |
| `未知`, `不详`, `未说明`, `UNK` | `U` | |

> **needs human confirmation**: ICD versions (WHO / CM / Australia AM / Canada CA) differ structurally; the version must be declared per data source, otherwise the same string is valid under one version but not another.
> **insufficient evidence — manual enrichment suggested**: SNOMED CT, UMLS, ATC, ICPC require licensed code tables and cannot be provided as mappings in Markdown; an external terminology service is needed.
