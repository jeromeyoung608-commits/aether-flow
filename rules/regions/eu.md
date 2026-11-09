---
id: region.eu
version: 1
scope: region
field_types: [identifier, number, text]
regions: [AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE]
industries: []
severity: warning
direction: both
evidence: medium
source: ["EU VAT Directive 2006/112/EC", "SWIFT IBAN Registry", "EC VIES", "ISO 13616"]
---

# European Union Region Rule Pack

## 1. Applicable Scope

Workspaces declared as EU regions (or specific member states); fields involve VAT number, IBAN, postcode, and company registration number.

**Important premise**: The EU **has no unified ID-number standard** and no unified postcode format. This pack is organized by "member-state listing" and does not assume "EU-wide uniform rules." Assuming the EU has a uniform format is the most common error when processing European data.

## 2. Validation / Normalization Logic

**2.1 VAT Number (by member-state structure)**

```regex
^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[A-Z0-9]{8,12}$
```

Member-state structures differ greatly, and **most countries have only structural validation, no check digit**:

| Country | Prefix | Entity Structure | Check Digit |
| :--- | :--- | :--- | :--- |
| AT | `ATU` | 8 digits (`ATU` + 8 digits, actual total length 11) | yes (mod 11 variant) |
| BE | `BE` | 10 digits | yes (mod 97, last 2 digits) |
| DE | `DE` | 9 digits | **none** (structural only) |
| ES | `ES` | 9 digits (with letters) | yes |
| FR | `FR` | 11 digits (2 digits + 9 digits) | yes (mod 97) |
| IT | `IT` | 11 digits | yes (Luhn variant) |
| NL | `NL` | 12 digits (9 digits + `B` + 2 digits) | yes (mod 97 / 11) |
| PL | `PL` | 10 digits | yes |
| SE | `SE` | 12 digits | yes (Luhn) |

**Key reminders**:
- Greece uses `EL` instead of `GR` (an EU VAT exception, distinct from ISO 3166's `GR`)
- Northern Ireland uses the `XI` prefix (post-Brexit arrangement), not part of `GB`
- **VIES online validation requires a network request; this product forbids outbound network access, so only structure and check digits can be performed, and we cannot confirm whether the number is truly registered.** This must be stated in the UI; otherwise users will mistakenly believe "validation passed = number valid".

**2.2 IBAN (ISO 13616)**

```regex
^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$
```

Total length 15–34, varies by country:

| Country | Length | Country | Length |
| :--- | :--- | :--- | :--- |
| AT | 20 | IT | 27 |
| BE | 16 | LU | 20 |
| BG | 22 | LV | 21 |
| HR | 21 | LT | 20 |
| CY | 28 | MT | 31 |
| CZ | 24 | NL | 18 |
| DK | 18 | PL | 28 |
| EE | 20 | PT | 25 |
| FI | 18 | RO | 24 |
| FR | 27 | SK | 24 |
| DE | 22 | SI | 19 |
| GR | 27 | ES | 24 |
| HU | 28 | SE | 24 |
| IE | 22 | GB | 22 |
| NO | 15 | CH | 21 |

**MOD-97 Validation (full algorithm)**:

```
1. Remove all spaces
2. Move the first 4 chars (country code + 2 check digits) to the end
3. Replace each letter with a two-digit value: A=10, B=11 ... Z=35
4. Take the resulting decimal big integer mod 97
5. The result must equal 1
```

The large integer must use **chunked string modulus** or BigInt; `Number` cannot be used (34-digit numbers far exceed 2^53).

**2.3 postcode (per member-state listing)**

| Country | Format | Regex |
| :--- | :--- | :--- |
| DE | 5 digits | `^\d{5}$` |
| FR | 5 digits | `^\d{5}$` |
| IT | 5 digits | `^\d{5}$` |
| ES | 5 digits | `^\d{5}$` |
| NL | 4 digits + 2 letters | `^\d{4}[A-Z]{2}$` |
| BE | 4 digits | `^\d{4}$` |
| AT | 4 digits | `^\d{4}$` |
| PL | 5 digits (`00-000`) | `^\d{2}-\d{3}$` |
| SE | 5 digits (`123 45`) | `^\d{3} \d{2}$` |
| IE | alphanumeric (Eircode) | `^[A-Z]\d{2}[A-Z0-9]{4}$` |

**Ireland's Eircode is the most special in the EU**: form `D02 X285`, 7 chars, first letter + 2 digits + 4 digits. Do not apply the numeric-postal-code intuition.

**2.4 Company Registration Number**

At the EU level there is no unified number. Formats differ by country (DE's Handelsregisternummer, FR's SIREN/SIRET, IT's Codice Fiscale / Partita IVA, NL's KvK). **insufficient evidence — manual enrichment suggested** — this pack does not provide regexes for each member state's company registration number, because verifiable public specifications are lacking; a wrong regex is worse than none.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `DE12345678` | reject | German VAT entity is 9 digits |
| `DE123456789` | valid (structure) | 9 digits; but no check digit, validity cannot be confirmed |
| `GR123456789` | `EL123456789` | Greek VAT prefix is EL |
| `GB123456789` (Northern Ireland) | `XI123456789` | Post-Brexit Northern Ireland uses XI |
| `de123 456 789` | `DE123456789` | normalize: uppercase + remove spaces |
| `ATU12345678` | valid | note `ATU` is part of the prefix |
| `NL123456789B01` | valid | 12-digit structure |
| `BE0123456789` | check digit must be verified | Belgium mod 97 |
| IBAN `DE89 3704 0044 0532 0130 00` | valid (22 digits, MOD-97 passed) | spaces must be removed before validation |
| IBAN `DE89 3704 0044 0532 0130 01` | reject | check digit wrong, MOD-97 ≠ 1 |
| IBAN `FR76 3000 6000 0112 3456 7890 189` | valid | 27 digits |
| IBAN `GB29 NWBK 6016 1331 9268 19` | valid | 22 digits |
| `D02X285` | `D02 X285` | Ireland Eircode normalize adds space |
| `12345` (NL) | reject | Dutch postcode must be 4 digits + 2 letters |
| `12-345` (PL) | valid | Polish `NN-NNN` |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `USt-IdNr.`, `UStId`, `VAT ID` | `vat` | common German abbreviation |
| `TVA`, `Numéro de TVA` | `vat` | French |
| `Partita IVA`, `P.IVA` | `vat` | Italian |
| `NIF`, `CIF` | `vat`(Spain: distinguish NIF/CIF entity type) | |
| `Codice Fiscale` | Note: this is a **personal tax ID**, not VAT | different from Partita IVA, must not be mixed |
| `SIREN` / `SIRET` | French company number (SIRET = SIREN + 3-digit facility code) | not VAT |
| `KvK` | Dutch chamber of commerce number | not VAT |

> **needs human confirmation**: Member-state VAT check-digit algorithms have multiple versions (especially AT, IT, NL), and the EU adjusts as new members join; amount handling should also reference `form.enums-currency.md`.
> **insufficient evidence — manual enrichment suggested**: EU member states' company registration number regexes lack verifiable validation, not included.
