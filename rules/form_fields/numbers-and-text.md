---
id: form.numbers-text
version: 1
scope: field
field_types: [number, text, identifier]
regions: [global]
industries: []
severity: info
direction: normalize
evidence: high
source: ["CLDR number formats", "Unicode UAX #15 (NFKC)", "IEEE 754", "ISO 80000-1"]
---

# Numbers & Text Rule Pack

## 1. Applicable Scope

The final shaping pass for all numeric, identifier, and free-text columns before they enter analysis and presentation. This pack addresses the problem of "the same value having multiple representations"; it does not perform business-level validation (business validation lives in `regions/` and `industries/`).

This entire pack is `severity: info` (safe rewrite), **except two cases that must be escalated to `warning`**: leading zeros and over-precision integers — see 2.3 and 2.4.

## 2. Validation / Normalization Logic

**2.1 Dual Ambiguity of Numeric Formats**

`1,234.56` (Imperial) and `1.234,56` (European) are semantically identical but written oppositely. Disambiguation rules:

```
1. If both ',' and '.' are present:
   - The last symbol to appear is the decimal point; the other is the thousands separator
2. If only ',' is present:
   - Exactly 3 digits follow AND other samples in the column contain '.' or the value range looks like an amount → treat as thousands separator
   - 1-2 digits follow → treat as decimal point (e.g. "12,5")
   - Cannot determine → warning, do not auto-convert
3. If only '.' is present: same as above, judged in reverse
4. Spaces (U+0020 / U+00A0 / U+202F) and apostrophe "'" are always treated as thousands separators
```

Column-level consistency takes priority: when a majority convention appears within a column, minority values are interpreted per the majority and the rewritten rows are flagged.

**2.2 Parenthesized Negatives (Accounting Notation)**

`(1,234.56)` → `-1234.56`. This is the most common negative-number representation in financial reports, not a formatting error. Also handle `1,234.56-` (trailing minus, from some ERP exports).

**2.3 Leading Zeros (must escalate to `warning`)**

`00123` as a **number** is 123; as a **code** (SKU, 邮编, account, 工号) it must be kept as the string `"00123"`.

Disambiguation basis:
- Column name contains `id / code / sku / zip / postal / account / no / 编号 / 编码` → keep as text
- Leading zeros are randomly distributed within the column (not uniform padding) → keep as text
- All values in the column have equal length and carry leading zeros → likely padded codes → keep as text
- Pure numeric columns (amount, quantity, ratio) → leading zeros may be stripped

**Default strategy: always keep as text first, and only convert when the user explicitly declares the column as numeric.** Losing leading zeros is irreversible and is often only discovered downstream.

**2.4 Over-Precision Integers (must escalate to `warning`)**

JavaScript `Number` safe-integer ceiling `2^53-1 = 9007199254740991` (16 digits). Beyond that, precision is lost:

- 19-digit order number `1234567890123456789` → `1234567890123456800`
- 18-digit 身份证 / bank card number → inevitably distorted
- Excel first writes them in scientific notation `1.23457E+18`

**Rule: any ≥16-digit pure number must be handled as a string; never pass it through `Number()`.** Display and export must preserve the original characters.

**2.5 Fullwidth Characters & Unicode Normalization**

```
NFKC normalization: fullwidth digits ０-９ → 0-9
           fullwidth letters Ａ-Ｚ → A-Z
           fullwidth punctuation ，．（）→ , . ( )
           Kangxi radicals, compatibility Han characters → standard Han characters
```

**Do not** apply any normalization beyond NFKC to: emoji, or text that needs to preserve variant selection (e.g. some person names).

**2.6 Whitespace & Invisible Characters**

| Character | Code point | Handling |
| :--- | :--- | :--- |
| Non-breaking space | U+00A0 | → regular space, then trim |
| Narrow no-break space | U+202F | delete when used as numeric thousands separator; otherwise convert to space |
| Zero-width space | U+200B | delete |
| Zero-width non-joiner | U+200C / U+200D | **keep** (required by some writing systems) |
| BOM | U+FEFF | delete (including when it appears mid-field) |
| Line separator | U+2028 / U+2029 | → `\n` |
| Soft hyphen | U+00AD | delete |
| Control characters | C0 / C1 | delete, and log |

**2.7 Conservative Structural Text Cleaning**

- Trim leading/trailing whitespace (after 2.6).
- Collapse consecutive spaces to a single space: **only when the column does not contain addresses, remarks, or multi-line descriptions**. Otherwise meaningful formatting is destroyed.
- Line breaks: `\r\n` → `\n`; in-field line breaks are preserved (do not collapse).
- Quotes: curly quotes `“ ” ‘ ’` → straight quotes, only in structured fields (codes, names); free text keeps them.
- Trailing punctuation: pasted lists often carry trailing `,` `;`, which are cleaned in enum columns but left in free text.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `1.234,56` (European) | `1234.56` | decimal comma |
| `1,234.56` (Imperial) | `1234.56` | thousands-separator comma |
| `1 234,56` | `1234.56` | space thousands separator (French/Russian) |
| `1'234.56` | `1234.56` | apostrophe thousands separator (Swiss) |
| `(1,234.56)` | `-1234.56` | accounting parenthesized negative |
| `1,234.56-` | `-1234.56` | trailing minus |
| `00123` (code column) | `"00123"` (text) | leading zeros must be preserved |
| `00123` (quantity column) | `123` | numeric columns may strip zeros; requires column-level declaration |
| `1234567890123456789` | `"1234567890123456789"` | 19-digit over-precision; forbids Number |
| `1.23457E+18` | `"1234567890123456789"` | already corrupted by Excel; prompt re-import of source data |
| `０１２３` | `0123` | fullwidth digits |
| `" 张三 "` | `"张三"` | leading/trailing whitespace (incl. U+00A0) |
| `"张\u200b三"` | `"张三"` | zero-width space |
| `"Zhang  Wei"` (name) | `"Zhang Wei"` | consecutive spaces (non address/remark column) |
| `"12,5"` (no other samples) | TBD + warning | single value cannot determine decimal separator |
| `-0` | `0` | negative zero normalized |
| `"  "` (all whitespace) | empty (null) | blank string equals empty |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `1e3`, `1E3` | `1000` | scientific notation (if the original intent was an exact integer, keep the original) |
| `∞`, `Infinity` | empty + flag | illegal numeric value |
| `NaN`, `#N/A`, `#DIV/0!`, `#VALUE!` | empty + flag | residual Excel error value |
| `--`, `—`, `–` standalone | empty (null) | placeholder |
| `0.00%`, `12.5 %` | `12.5` (numeric) + unit stored separately | percent sign must be judged together with semantics |

> **needs human confirmation**: typographic conventions for "negative numbers" and "thousands separators" vary by region across languages (e.g. India uses 12,34,567's 2-2-3 grouping); this pack only covers the general 3-digit grouping case, and Indian-style grouping needs a separate rule.
