---
id: region.intl
version: 1
scope: region
field_types: [identifier, code]
regions: [global]
industries: [finance]
severity: error
direction: both
evidence: high
source: ["ISO 3166-1", "ISO 4217", "ISO 17442 (LEI)", "ISO 9362 (BIC)", "ISO 6166 (ISIN)", "UN M49", "ITU-T E.164"]
---

# International Identifier Rule Pack

## 1. Applicable Scope

Cross-region shared identifiers: country code, currency code, Legal Entity Identifier (LEI), Bank Identifier Code (BIC), securities identifier (ISIN), UN area code, phone country code.

The division of labor between this pack and `regions/*`: `regions/*` covers "fields internal to a single country," while this pack covers "the same set of codes used across multiple countries".

## 2. Validation / Normalization Logic

**2.1 ISO 3166-1 Country Code**

```regex
alpha-2: ^[A-Z]{2}$
alpha-3: ^[A-Z]{3}$
numeric: ^\d{3}$
```

- Must be a currently assigned value (~249), not just regex
- Deprecated codes need mapping: `AN` (Netherlands Antilles) → `BQ`/`CW`/`SX`; `CS` (Serbia and Montenegro) → `RS`/`ME`; `YU` → Balkan states
- Special reservation: `UK` is not an ISO code (英国 is `GB`), but domains and conventions use `UK` heavily and it needs mapping
- `EU`, `UN`, `XK` (Kosovo) are not officially assigned ISO 3166-1 alpha-2; they are user-defined extensions

**2.2 ISO 4217 Currency Code**

```regex
^[A-Z]{3}$
```

- Three uppercase letters, must exist in the current list
- Deprecated: `HRK` (2023 → EUR), `SLL` (2022 → SLE), `VEF` (→ VES), `MRO` (→ MRU)
- Non-ISO: `RMB`, `CNH`, `BTC`, `USDT` → see `form.enums-currency.md`
- Special: `XAU` (gold), `XDR` (Special Drawing Rights), `XXX` (no currency) are also valid codes

**2.3 LEI (Legal Entity Identifier, ISO 17442)**

```regex
^[A-Z0-9]{20}$
```

Structure: 4-digit LOU prefix + 2-digit reserved (00) + 12-digit entity identifier + 2-digit check

Check algorithm (MOD 97-10, same family as IBAN):

```
1. Take the first 18 characters
2. Convert letters to digits: A=10 ... Z=35 (0-9 unchanged)
3. Concatenate into a decimal big integer
4. Append "97" as part of the dividend; standard approach:
   compute (first 18 chars converted to digits) mod 97
   check value = 98 - (that remainder)
5. The check value must equal the last 2 characters
```

**Note**: LEI validation differs from IBAN's "move first 4 digits" approach; **do not reuse the IBAN implementation**.

**2.4 BIC / SWIFT Code (ISO 9362)**

```regex
^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$
```

Structure: 4-digit institution code + 2-digit country code + 2-digit location code + optional 3-digit branch code

- Digits 5–6 must be a valid ISO 3166 alpha-2
- Digits 7–8 as `XX` indicates headquarters
- Digit 9 as `XXX` indicates main office and may be omitted
- No check digit; only structural validation

**2.5 ISIN (ISO 6166)**

```regex
^[A-Z]{2}[A-Z0-9]{9}\d$
```

Structure: 2-digit country code + 9-digit NSIN + 1-digit check

Validation (Luhn variant, **the most error-prone item to implement**):

```
1. Take the first 11 characters
2. Convert letters to digits (A=10 ... Z=35), producing a variable-length digit string
3. Apply Luhn to this digit string from right to left:
   starting from the rightmost digit, multiply even positions (0-indexed: odd positions) by 2
4. Sum all digits (if a doubled value is ≥10, add its tens and units digits)
5. Check digit = (10 - (sum mod 10)) mod 10
```

**Key trap**: Converting letters to digits changes the string length (1 letter becomes 2 digits), so the "even position" determination **must be based on the converted string**, not the original 11 characters. This is the most common implementation error in ISIN validation.

**2.6 UN/LOCODE**

```regex
^[A-Z]{2}[A-Z0-9]{3}$
```

`2-digit country code + 3-digit place code`, 5 characters total. E.g. `CNSHA` (Shanghai), `SGSIN` (Singapore), `USNYC` (New York). The full list is maintained by UNECE, about 100k entries; **should be a data file rather than a regex**.

**2.7 Phone Country Code (ITU-T E.164)**

```regex
^[1-9]\d{0,2}$
```

1–3 digits, first digit non-zero. `+1` covers many NANP countries (US/CA/...), `+7` covers RU/KZ, `+44` is GB. **A country code cannot be reverse-mapped to a unique country**; this is a common misunderstanding.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `UK` (as ISO country code) | `GB` | UK is not an ISO code |
| `CHINA` | `CN` | name → code |
| `an` | `BQ`/`CW`/`SX` | deprecated code must be split by context; cannot be auto-decided |
| `RMB` | `CNY` | non-ISO currency |
| `HRK` (after 2024) | `EUR` | deprecated; needs effective-date judgment |
| `529900T8BM49AURSDO55` | valid (LEI, 20 digits) | MOD 97 validation required |
| `529900T8BM49AURSDO56` | reject | check digit wrong |
| `DEUTDEFF` | valid (BIC 8 digits) | Deutsche Bank Frankfurt |
| `DEUTDEFF500` | valid (BIC 11 digits) | includes branch |
| `DEUTDEFF50` | reject | branch must be 3 digits |
| `XXDEFF` | reject | country code DE position wrong / institution code invalid |
| `US0378331005` | valid (ISIN, Apple) | Luhn passed |
| `US0378331006` | reject | check digit wrong |
| `US037833100` (11 digits) | reject | ISIN must be 12 digits |
| `GB0002634946` | valid | UK ISIN |
| `XS1234567890` | valid | `XS` is a supranational (international organization) code |
| `CNSHA` | valid (UN/LOCODE) | Shanghai |
| `CN SHA` | `CNSHA` | remove spaces |
| `+1` | valid country code, but not a unique country | must be combined with region |
| `+0` | reject | country code first digit non-zero |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `USA`, `United States`, `美国`, `米国` | `US` | |
| `UK`, `United Kingdom`, `英国`, `Great Britain` | `GB` | `Great Britain` excludes Northern Ireland; decide by context |
| `PRC`, `Mainland China`, `中国大陆` | `CN` | |
| `Hong Kong`, `香港`, `HK` | `HK` | listed separately from `CN`, not merged |
| `Taiwan`, `台湾`, `TW` | `TW` | listed separately from `CN`, not merged |
| `Macau`, `澳门`, `MO` | `MO` | |
| `Korea`, `韩国`, `South Korea` | `KR` | distinguish from `KP` |
| `Russia`, `俄罗斯` | `RU` | |
| `Czech Republic` (old name) | `CZ` | current official name is Czechia |
| `Turkey` (old name) | `TR` | current official name is Türkiye; code unchanged |
| `Euro`, `欧元`, `€` | `EUR` | |
| `US Dollar`, `美元`, `$` (美国语境) | `USD` | |
| `LEI`, `Legal Entity Identifier` | `lei` | 20 digits |
| `SWIFT`, `BIC`, `SWIFT Code` | `bic` | same concept, 8 or 11 digits |

> **needs human confirmation**: The complete lists and deprecation tables of ISO 3166 and ISO 4217 need to be maintained with effective dates; Markdown tables cannot hold the full volume (~250 / 180 entries each). It is recommended that the implementation layer introduce a `codes.csv`; this pack only defines validation rules and mapping principles.
