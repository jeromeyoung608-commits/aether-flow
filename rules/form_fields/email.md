---
id: form.email
version: 1
scope: field
field_types: [email]
regions: [global]
industries: []
severity: warning
direction: both
evidence: high
source: ["RFC 5321", "RFC 5322", "RFC 6531", "UAX #31"]
---

# Email Address Rule Pack

## 1. Applicable Scope

Any form field whose semantics are "email address": registration, invoice recipient, customer master data, supplier contact info, notification address.

Applicability test: ≥80% of samples in the column name or values contain `@`. Does not apply to `user@host` fields whose semantics are system accounts (e.g. FTP login names); those should be classified as `identifier`.

## 2. Validation / Normalization Logic

**2.1 Practical Validation Regex**

```regex
^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$
```

This is a **practical regex** covering 99%+ of real addresses, **not** the full RFC 5322 grammar (the full grammar includes comments, quoted local parts, bare-IP domains, etc., which almost never appear in practice and would make the regex unmaintainable). For addresses that don't match but look reasonable, flag `warning` and keep the original value — do not discard.

**2.2 Structural Checks (beyond the regex)**

| Check | Rule |
| :--- | :--- |
| Length | local part ≤ 64, domain ≤ 255, total ≤ 254 |
| Dot position | not starting/ending with `.`, no consecutive `..` |
| Domain label | each label ≤ 63, not starting/ending with `-` |
| TLD | ≥2 characters and must be alphabetic (excludes `user@host.12`) |
| Single-label domain | `user@localhost` treated as invalid (form scenario) |

**2.3 Normalization (safe to auto-apply, `severity: info`)**

1. Trim leading/trailing whitespace, including U+00A0, U+200B, U+FEFF.
2. Remove wrapping angle brackets `<>` and the `mailto:` prefix.
3. Split display-name form: `"Zhang, Wei" <wei@corp.com>` → take the address part, store display-name separately.
4. **Lowercase the domain**; **preserve the case of the local part** (RFC 5321 allows case-sensitive local parts; although in reality it's almost never sensitive, rewriting would break a few systems).
5. IDN domains: keep the Unicode original, store punycode separately (`müller.de` → `xn--mller-kva.de`) for deduplication comparison.
6. Remove trailing punctuation: `a@b.com,` / `a@b.com.` / `a@b.com;` → `a@b.com`.

**2.4 Homoglyphs & Security (`severity: warning`, not auto-changed)**

- Mixed-script domains (Latin + Cyrillic): `аpple.com` (first char is Cyrillic а) → highly suspicious, flag.
- `xn--` appears in the domain but the original value is not in punycode form → possible bypass attempt.
- Local part contains `+` tags (`a+tag@b.com`): allowed by RFC, but if many appear in the same column, they are mostly test data or spam registrations; flag `info` rather than error.

**2.5 Parts Not Validated (explicitly out of scope)**

- **Do not verify whether the mailbox actually exists.** SMTP probing requires network requests, violating this product's zero-egress boundary.
- No MX record lookup.
- Do not judge whether it is a disposable email domain (requires an online list, and the list itself is an external dependency).

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `zhang wei@corp.com` | `zhang.wei@corp.com` | local part contains a space; cannot determine whether to change to a dot; flag warning for user confirmation |
| `wei@corp` | `wei@corp.com` | single-label domain, invalid in most form scenarios |
| `wei@corp..com` | `wei@corp.com` | consecutive dots |
| `<wei@corp.com>` | `wei@corp.com` | angle-bracket wrapping |
| `mailto:wei@corp.com` | `wei@corp.com` | scheme prefix |
| `"Zhang, Wei" <wei@corp.com>` | `wei@corp.com` | display-name form; name stored separately |
| `wei@corp.com,` | `wei@corp.com` | trailing comma (pasted from list) |
| `wei@Corp.COM` | `wei@corp.com` | domain case unified; local part untouched |
| `wei@@corp.com` | `wei@corp.com` | duplicate `@` |
| `wei@corp.com ` | `wei@corp.com` | trailing space (incl. U+00A0) |
| `аpple.com`'s `а` | `apple.com` | Cyrillic homoglyph; cannot be auto-fixed, only flagged |
| `ｗｅｉ＠ｃｏｒｐ．ｃｏｍ` | `wei@corp.com` | fullwidth characters; apply NFKC normalization before validating |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `N/A`, `none`, `-`, `无`, `未提供` | empty (null) | a placeholder is not an email. Convert to null and record `filled_with_placeholder` |
| `unknown@unknown.com` | empty (null) | common system placeholder; must be distinguished from a real address; confirm with user |
| `test@test.com` | keep but flag | may be test data; do not silently delete |
| `TBD`, `待定` | empty (null) | same as above |

> **needs human confirmation**: the placeholder vocabulary varies by organization; it is recommended to let the workspace override this section's table rather than hard-coding it in the rule.
