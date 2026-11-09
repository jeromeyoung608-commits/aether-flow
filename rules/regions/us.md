---
id: region.us
version: 1
scope: region
field_types: [identifier, phone, number]
regions: [US]
industries: []
severity: error
direction: both
evidence: high
source: ["SSA POMS", "IRS EIN prefixes", "USPS Publication 28", "NANP", "ABA routing standard"]
---

# United States Region Rule Pack

## 1. Applicable Scope

Workspaces declared as US regions; fields involve SSN, EIN, ITIN, ZIP, state, phone, bank routing number.

Must explicitly declare `region: US`. This pack does not cover Canada (SIN is 9 digits with a different algorithm) or Mexico.

## 2. Validation / Normalization Logic

**2.1 SSN (Social Security Number)**

```regex
^(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}$
```

Segment exclusion rules (this is the entire substance of SSN validation):

| Segment | Excluded | Reason |
| :--- | :--- | :--- |
| Area code (first 3) | `000`, `666`, `900–999` | never assigned / reserved |
| Group number (middle 2) | `00` | never assigned |
| Serial number (last 4) | `0000` | never assigned |

**Important**: Since 2011 SSN assignment is randomized and no longer encodes region; therefore **the first 3 digits must not be used to infer birthplace** (many old rules did this and are now invalid).

**Normalization discipline (avoid over-matching)**: A bare 9-digit number (no separator) is **not** automatically padded into the `ddd-dd-dddd` form. Nine digits is only a length, not an SSN trait — order numbers, batch numbers, legacy organization codes, invoice numbers, and bank-account fragments are also commonly 9 digits; rewriting based on shape alone would pollute those columns. Only when a column explicitly declares `region:US` **and** its name/context clearly indicates an identifier should SSN validation be applied to that column; otherwise retain the original value, mark it `ambiguous_identifier`, and do not transform.

**2.2 EIN (Employer Identification Number)**

```regex
^\d{2}-\d{7}$
```

The prefix has an official valid list (`01–06, 10–16, 20–27, 30–39, 40–48, 50–60, 61–65, 71–77, 80–88, 90–99`, etc.), expanding over time). **The prefix table is changable data**, so the implementation layer should use a year-tagged data file; only the structural rule is given here (the `evidence: medium` part).

**2.3 ITIN (Individual Taxpayer Identification Number)**

```regex
^9\d{2}-(7\d|8[0-8])-\d{4}$
```

Structure: `9` + 2 digits + 4th digit is `7` or `8` + 4 digits. A 4th digit of `9x` is an AIN, not an ITIN.

**2.4 ZIP / ZIP+4**

```regex
^\d{5}(-\d{4})?$
```

- `ZIP`: 5 digits, first digit may be 0 (`02134` is a valid Boston ZIP, **must not be treated as a number**)
- `ZIP+4`: `12345-6789`, separator must be `-` (space form should be normalized)
- The first 3 digits represent a region and may suggest the source state, but **must not be used as a mandatory check** (cross-state boundaries exist)

**2.5 State / Territory Abbreviations**

Two uppercase letters; must belong to:

```
AL AK AZ AR CA CO CT DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO
MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI
WV WY DC AS GU MP PR VI UM
```

**Regularity trap**: `AK` ≠ `AL`, `MI` ≠ `MN`; easily confused during manual entry, cannot be auto-judged by rules, only membership can be validated.

**2.6 Phone Number (NANP)**

```regex
^\+1[2-9]\d{2}[2-9]\d{6}$
```

- Area code first digit must be `2–9` (`0`/`1` are service codes or long-distance prefixes)
- Exchange code (middle 3 digits) first digit must be `2–9` (`N11` codes like `911`, `411` are reserved)
- The middle 3 digits may contain `0`/`1`
- Common dirty forms: `1-800-555-1212`, `(800) 555-1212`, `800.555.1212`, `8005551212x123`

**2.7 Bank Routing Number (ABA Routing Number)**

```regex
^[0-3]\d{7}$
```

Algorithm:

```
d1 d2 d3 d4 d5 d6 d7 d8 d9
S = 3*(d1+d4+d7) + 7*(d2+d5+d8) + 1*(d3+d6+d9)
S must be a multiple of 10
```

The first two digits must also fall in valid ranges: `01–12` (ordinary), `21–32` (savings institutions), `61–72` (credit unions), `80` (special).

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `123-45-6789` | valid (if segments not excluded) | classic example value, real and never assigned |
| `000-12-3456` | reject | area code 000 |
| `666-12-3456` | reject | area code 666 reserved |
| `900-12-3456` | reject | 9xx reserved |
| `123-00-6789` | reject | group number 00 |
| `123-45-0000` | reject | serial number 0000 |
| `123456789` (bare 9-digit) | **not normalized**, marked as `ambiguous_identifier` | 9 digits is not an SSN trait (order/EIN/routing/invoice numbers are also commonly 9 digits); never rewrite into SSN form based on shape — retain original value, needs human confirmation |
| `12-3456789` | `12-3456789` | EIN valid structure |
| `9xx-9x-xxxx` | reject as ITIN | 4th digit 9 belongs to AIN |
| `02134` (ZIP) | `"02134"` | leading 0, must be text |
| `2134` | reject, or zero-padding needs confirmation | typical symptom of lost leading zero |
| `12345 6789` | `12345-6789` | ZIP+4 separator normalized |
| `12345-678` | reject | +4 must be 4 digits |
| `FL` → `FL` | valid | state membership passed |
| `FI` (Fiji) | reject | not a US state |
| `(800) 555-1212` | `+18005551212` | normalize to E.164 |
| `+1 (011) 555-1212` | reject | area code first digit 1 invalid |
| `1234567890abcdef` | reject | non-numeric |
| routing number `111000025` | valid (check passed) | algorithmic verification required |
| routing number `111000024` | reject | checksum not a multiple of 10 |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `SSN`, `Social Security Number`, `社保号` | `ssn` | Chinese texts often mistakenly call it 「社保号」; it is actually a tax-number type identifier |
| `EIN`, `Tax ID`, `FEIN`, `联邦税号` | `ein` | |
| `ITIN` | `itin` | must be distinguished from SSN when mixed |
| `Zip`, `Zip Code`, `Postal Code` | `zip` | under US context, Postal Code means ZIP |
| `State`, `Province` (Province appears in US data) | `state` | field name is wrong, should be corrected |
| `Routing Number`, `ABA`, `RTN` | `aba_routing` | |

> **needs human confirmation**: Driver License numbers are defined by each of the 50 states, formats are mutually incompatible and mostly not public; **insufficient evidence — manual enrichment suggested**; this pack provides no rules.
> **needs human confirmation**: The EIN prefix valid table expands over time and must follow the current IRS bulletin.
