---
id: form.date-time
version: 1
scope: field
field_types: [date]
regions: [global]
industries: []
severity: warning
direction: both
evidence: high
source: ["ISO 8601-1:2019", "ISO 8601-2:2019", "ECMA-376 (Excel serial dates)", "CLDR date formats"]
---

# Date & Time Rule Pack

## 1. Applicable Scope

Any field whose semantics are date, time, or date-time: order date, effective date, birth date, billing period, delivery deadline, audit timestamp.

**Core thesis of this pack: date is the field with the highest error rate in dirty data, and the vast majority of errors come from "order ambiguity" rather than format errors.** Therefore the default behavior of this pack is "normalize when certain, ask when not," and never guess.

## 2. Validation / Normalization Logic

**2.1 Standard Target Forms**

| Semantics | Target | Regex |
| :--- | :--- | :--- |
| Pure date | `YYYY-MM-DD` | `^\d{4}-\d{2}-\d{2}$` |
| Date-time (local) | `YYYY-MM-DDTHH:mm:ss` | `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$` |
| Date-time (with timezone) | `...Z` or `...+08:00` | `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z\|[+-]\d{2}:\d{2})$` |
| Time | `HH:mm:ss` | `^\d{2}:\d{2}:\d{2}$` |

**2.2 Order-Ambiguity Determination (the most important section)**

Disambiguation flow for the `D1/D2/Y` form (`01/05/2024`, `1/5/24`):

```
Let a = first number, b = second number
if a > 12 and b <= 12  → determined DD/MM (day first)
if b > 12 and a <= 12  → determined MM/DD (month first)
if a <= 12 and b <= 12  → ambiguous!
    ├─ If any sample in the column has a > 12 → treat the column as DD/MM, interpret the whole column accordingly (column-level consistency)
    ├─ If any sample in the column has b > 12 → treat the column as MM/DD
    └─ Neither → severity: warning, needs_user_input, do not auto-convert
if a > 12 and b > 12  → invalid value, error
```

**Never** infer using "current regional habit" or "looks more like". One wrong date guess shifts the entire report by a month, and users often only discover it after delivery.

**2.3 Recognizable Non-Standard Forms (normalizable, `severity: info`)**

| Form | Example | Normalization |
| :--- | :--- | :--- |
| Year-month-day concatenation | `20240105`, `2024年1月5日` | parse directly |
| Chinese date | `2024年01月05日`, `2024/1/5` | parse directly |
| English month name | `Jan 5, 2024`, `5 Jan 2024`, `05-JAN-2024` | month-name table mapping |
| Two-digit year | `05/01/24` | determine order first, then 00–69 → 20xx, 70–99 → 19xx |
| Excel serial number | `45296` | see 2.4 |
| Unix seconds | `1704326400` | 10 digits → seconds |
| Unix milliseconds | `1704326400000` | 13 digits → milliseconds |
| With timezone abbreviation | `2024-01-05 10:00:00 CST` | timezone abbreviation unreliable; see 2.6 |

**2.4 Excel Serial Numbers (must be hard-coded, or off by one day)**

Excel wrongly treats 1900 as a leap year, producing the non-existent `1900-02-29` (serial number 60).

```
serial <= 59   → date = 1899-12-31 + serial days
serial == 60   → invalid (Excel's phantom leap day)
serial >= 61   → date = 1899-12-30 + serial days
```

Equivalent common formula: `DATE(1899,12,30) + serial` (correct only for serial ≥ 61). **If the implementation uses only the latter formula without handling serial ≤ 60, it will produce an off-by-one-day result.**

**2.5 Time Portion**

- 12-hour clock: `09:30 PM` → `21:30:00`; `12:00 AM` → `00:00:00`; `12:00 PM` → `12:00:00` (these three boundary cases are the easiest to get wrong).
- The 24-hour `24:00` is a valid ISO 8601 expression (denoting end of day); normalize to next day's `00:00:00` or keep `24:00:00` — pick one in the implementation and stay consistent.
- Millisecond precision: preserve, do not truncate.
- Leap second `:60`: rare; flag `warning`, do not convert.

**2.6 Hard Rules for Timezone Handling**

- **Datetime without timezone info must not be auto-assigned the local timezone.** Flag `warning: timezone_unspecified`.
- Timezone abbreviations (`CST`, `IST`, `BST`) are **unreliable**: `CST` can mean China, US Central, or Cuba; `IST` can mean India, Ireland, or Israel. Must flag `needs_user_input`; do not map.
- Only `Z` and `±HH:MM` can be safely converted.
- **Pure date fields (no time) are never timezone-converted.** This is the most common source of "off by one day": `2024-01-05` rendered at UTC-5 becomes `2024-01-04`.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `01/05/2024` (order cannot be determined) | `2024-01-05` **or** `2024-05-01` | must ask the user; do not guess |
| `2024/1/5` | `2024-01-05` | year first, unambiguous |
| `05/01/24` | `2024-01-05` | two-digit year + order determination |
| `45296` (Excel) | `2024-01-05` | 1899-12-30 + 45296 |
| `45296` and implementation used wrong formula | `2024-01-06` | typical off-by-one-day bug |
| `2024-13-01` | invalid (error) | month out of range |
| `2024-02-30` | invalid (error) | day does not exist in that month |
| `2023-02-29` | invalid (error) | not a leap year |
| `2024年1月5日` | `2024-01-05` | Chinese format |
| `Jan 5, 2024` | `2024-01-05` | English month name |
| `1704326400` | `2024-01-04T00:00:00Z` | Unix seconds (UTC) |
| `2024-01-05 10:00:00 CST` | keep + `needs_user_input` | CST region not unique |
| `09:30 PM` | `21:30:00` | 12-hour clock conversion |
| `12:00 AM` | `00:00:00` | midnight boundary |
| `2024-01-05` rendered at UTC-5 | `2024-01-05` | pure date field forbids timezone conversion |
| `0000-00-00` | empty + flag | MySQL zero-date residual |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `今天`, `today` | empty + flag | relative date cannot be statically normalized; requires runtime evaluation or left blank |
| `昨天`, `yesterday` | same as above | same as above |
| `TBD`, `待定`, `另行通知` | empty (null) | placeholder |
| `1900-01-01`, `1970-01-01` | keep but flag | common system default/epoch placeholder; not a real date |
| `9999-12-31` | keep but flag | common "permanently valid" placeholder |

> **needs human confirmation**: conventions for "fiscal year start" and "billing period days" vary greatly across industries (e.g. 4-4-5 calendar, lunar calendar); this pack does not cover them; if needed, they should be separate `industry.*` rule packs.
