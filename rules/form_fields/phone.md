---
id: form.phone
version: 1
scope: field
field_types: [phone]
regions: [global]
industries: []
severity: warning
direction: both
evidence: high
source: ["ITU-T E.164", "ITU-T E.123", "RFC 3966"]
---

# Phone Number Rule Pack

## 1. Applicable Scope

Field semantics: a phone number — mobile, landline, fax, support hotline, emergency contact.

Key premise: **this pack only performs "format normalization", not "number validity" checks.** Whether a number exists, is disconnected, or belongs to a carrier requires external data and is out of scope.

Region must be declared explicitly (`region.cn` / `region.us`, etc.); otherwise `0755-12345678` cannot be told apart as a Shenzhen landline in China vs. a local number elsewhere.

## 2. Validation / Normalization Logic

**2.1 Target form: E.164**

```regex
^\+[1-9]\d{1,14}$
```

That is: `+`, country code first digit non-zero, total 2–15 digits. This is the **only form that should be written to the standard column**.

**2.2 Normalization flow (in order)**

```
1. Remove all separators: spaces U+0020, U+00A0, ( ) - . / and Unicode dashes U+2010–U+2015
2. Full-width digits → half-width (NFKC)
3. Strip visual prefixes: tel: / TEL: / 电话: / Phone:
4. Extract extension: match (ext|x|#|转)\s*(\d{1,6}), strip from main number, store as `extension`
5. Handle leading zero:
   - already has "+" → validate country code, drop national trunk prefix "0" (e.g. +44 020 xxxx → +44 20 xxxx)
   - no "+" but region declared → add country code, drop national trunk prefix
6. Handle international prefix 00: 00 44... → +44...
7. Output E.164 + keep original value + keep extension
```

**2.3 National trunk prefixes per country (the "0" to strip)**

| Region | National form | Normalized | Note |
| :--- | :--- | :--- | :--- |
| CN | `0755-12345678` | `+8675512345678` | area-code leading 0 must be dropped |
| GB | `020 7946 0958` | `+442079460958` | UK national form keeps area-code leading 0; E.164 must drop it |
| DE | `030 123456` | `+4930123456` | same as above |
| FR | `01 23 45 67 89` | `+33123456789` | same as above |
| US/CA | `(415) 555-0100` | `+14155550100` | no national trunk prefix; just add `+1` |
| JP | `03-1234-5678` | `+81312345678` | area-code leading 0 dropped |

**Note**: Italian mobile numbers **keep** the leading 0 (`+39 0xxx`); this is an E.164 exception — do not strip it by the general rule.

**2.4 Clearly invalid values (`severity: error`)**

| Pattern | Reason |
| :--- | :--- |
| digit count < 7 | cannot be a complete number |
| digit count > 15 (excl. ext) | exceeds E.164 maximum |
| all same digit (`0000000`, `11111111`) | placeholder |
| contains letters outside extension | e.g. `415-CALL-NOW`; let user decide whether to keep as a vanity number |
| country code not in ITU assignment table | see `regions/international-codes.md` |

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `0755-12345678` (CN) | `+8675512345678` | strip area-code leading 0 |
| `+86 0755 1234 5678` | `+8675512345678` | still has national prefix 0 under +; strip another layer |
| `(415) 555-0100` (US) | `+14155550100` | remove parentheses and hyphens |
| `415.555.0100 x123` | `+14155550100`, ext=`123` | extension stripped |
| `0044 20 7946 0958` | `+442079460958` | `00` international prefix → `+` |
| `+44 (0)20 7946 0958` | `+442079460958` | `(0)` is a visual residue of the national prefix |
| `１３８００１３８０００` | `+8613800138000` | full-width digits |
| `000-000-0000` | empty + flag | placeholder |
| `+86 138 0013 8000 ` | `+8613800138000` | trailing space |
| `13800138000` (region undeclared) | reject normalization, `warning` | missing country code and no regional context; do not guess |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `123-456-7890转1234` | main number + `extension: 1234` | `转` is the Chinese extension marker |
| `ext. 1234` / `x1234` / `#1234` | `extension: 1234` | English extension markers |
| `N/A`, `无`, `-`, `not available` | empty (null) | placeholder |
| `+1-800-XXX-XXXX` | keep but flag | support placeholder number; needs human confirmation |

> **needs human confirmation**: the `+39` Italian leading-0 exception, plus in-country short numbers (e.g. China's 95xxx service numbers, short code 12345), cannot be exhaustively enumerated locally; better supplemented by a `region.*` pack.
