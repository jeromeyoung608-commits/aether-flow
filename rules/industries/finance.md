---
id: industry.finance
version: 1
scope: industry
field_types: [identifier, number, currency]
regions: [global]
industries: [finance]
severity: error
direction: both
evidence: high
source: ["ISO 7812 (Luhn)", "ISO 6166 (ISIN)", "CUSIP Global Services", "ISO 4217 minor units", "ISO 15022 / SWIFT MT"]
---

# Finance Industry Rule Pack

## 1. Applicable Scope

Form fields in banking, payments, securities, insurance, and finance shared-service centers: bank card number, security code, account number, amount precision, message reference number.

This pack only performs **structural validation** (format + check digit + precision) and **does not** perform balance, credit, or blacklist lookups — those require external services and violate the zero-egress boundary.

## 2. Validation / Normalization Logic

**2.1 Luhn Algorithm (bank cards, some national account numbers)**

Applies to: bank cards (PAN), IMEI, and some credit-card-derived numbers.

```
1. Starting from the rightmost (check) digit, moving left, multiply the 2nd, 4th, 6th... positions (i.e. the odd-indexed positions) by 2
2. If a product ≥ 10, add its tens and units digits (equivalent to subtracting 9)
3. Sum all digits
4. The total must be a multiple of 10
```

**Do not** implement 19+-digit numbers with `Number`, as precision will be lost. Process digit-by-digit using strings.

**2.2 Bank Card PAN Structure**

```regex
^[0-9]{12,19}$
```

| Prefix | Network |
| :--- | :--- |
| `4` | Visa (13/16/19 digits) |
| `51–55`, `2221–2229` | Mastercard |
| `34`, `37` | American Express (15 digits) |
| `62` | UnionPay (16–19 digits) |
| `35` | JCB |
| `6011`, `65` | Discover |

**Length varies by network and cannot be validated uniformly as 16 digits.** AmEx is 15 digits, which is the most common misjudgment.

**PCI DSS Note:** It is preferable for this product not to store card numbers in plaintext; if processing is unavoidable, the UI should mask by default (showing only the last 4 digits).

**2.3 CUSIP (North American securities, 9 digits)**

```regex
^[0-9A-Z*@#]{9}$
```

```
Character values: 0-9 → 0-9; A-Z → 10-35; * = 36; @ = 37; # = 38
Positions 1,3,5,7,9 (1-indexed odd positions) multiplied by 2
Positions 2,4,6,8 multiplied by 1
Sum all results digit-by-digit in decimal
Total must be a multiple of 10
```

**2.4 SEDOL (UK/Irish securities, 7 digits)**

```regex
^[0-9BCDFGHJKLMNPQRSTVWXYZ]{7}$
```

- **Excludes vowels** (A/E/I/O/U are deliberately excluded to avoid forming words)
- Validation: first 6 digits weighted `1,3,1,7,3,9`, letter values A=10…Z=35; after summing, `check digit = (10 − sum mod 10) mod 10`

**2.5 ISIN**

See `regions/international-codes.md` 2.5. The only emphasis here: **after converting letters to digits the string length changes, so Luhn's odd/even positions must be based on the converted string**.

**2.6 Amount Precision (ISO 4217 minor unit)**

| Currency | Decimal places | Example |
| :--- | :--- | :--- |
| JPY, KRW, VND, CLP, ISK | 0 | `1000` means 1000 units |
| USD, EUR, CNY, GBP, HKD | 2 | `1000.00` |
| BHD, KWD, OMR, JOD, TND, LYD | 3 | `1000.000` |
| CLF, UYW | 4 | special |
| most others | 2 | |

Rule: **the decimal places of an amount column must match the currency's minor unit.** `1234.5` in a CNY column means precision may have been lost (should be `1234.50`); in a JPY column it is an **error** (JPY should have no decimals).

**Forbidden:** using floating point for monetary arithmetic. Use integer minor units (cents) or decimal fixed-point.

**2.7 SWIFT MT / ISO 15022 Fields**

| Field | Content | Format |
| :--- | :--- | :--- |
| `:20:` | transaction reference number | `^[A-Z0-9/\\-]{1,16}$` (cannot end with `/` or `//`) |
| `:32A:` | value date + currency + amount | `YYMMDD` + `[A-Z]{3}` + amount (**comma must be used as the decimal separator**) |
| `:50K:` / `:59:` | remitter / beneficiary | multi-line; leading `/` denotes account number |
| `:71A:` | charge bearer | `BEN` / `OUR` / `SHA` |

**Amounts in MT messages must use `,` as the decimal point** (`1234,56`), the opposite of the common `1234.56` in CSV. General numeric rules must not be applied when parsing MT messages.

**2.8 Bank Account Number (non-IBAN regions)**

US ABA see `regions/us.md` 2.7. Account structures in China, India, Japan, etc. are defined by each bank; **insufficient evidence — manual enrichment suggested**; length should not be guessed.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `4532015112830366` | valid (Luhn passes) | 16-digit Visa test number |
| `4532015112830367` | reject | Luhn validation failed |
| `378282246310005` | valid | AmEx 15 digits; cannot use 16-digit rule |
| `1234-5678-9012-3456` | `1234567890123456` | validate after removing separators |
| `4532 0151 1283 0366` | `4532015112830366` | remove spaces |
| `037833100` | valid (CUSIP) | Apple |
| `037833101` | reject | CUSIP validation failed |
| `B0YBKJ7` | valid (SEDOL structure) | excludes vowels |
| `B0YBKJ8` | reject | check digit error |
| `JPY 1000.50` | reject or warn | JPY has no decimal places |
| `CNY 1234.5` | `1234.50` | insufficient decimal places |
| `KWD 1000.00` | `1000.000` | Kuwaiti dinar, 3 digits |
| MT `:32A:240105USD1234.56` | `:32A:240105USD1234,56` | MT amount uses comma |
| `USD 0.1 + 0.2` floating-point addition | compute in integer cents | floating-point precision trap (`0.30000000000000004`) |
| `:20:REF/` | reject | reference number cannot end with `/` |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `Credit Card`, `卡号`, `PAN`, `账号` | `pan` | "account number" in banking often means a deposit account; must be distinguished |
| `ISIN`, `证券代码`, `国际证券号` | `isin` | 12 digits |
| `CUSIP` | `cusip` | 9 digits, North America |
| `SEDOL` | `sedol` | 7 digits, UK |
| `Ticker`, `股票代码` | not a standard identifier | unique within an exchange; conflicts across exchanges; must be combined with a market code |
| `SWIFT`, `BIC` | `bic` | |
| `Value Date`, `起息日`, `交割日` | `value_date` | |
| `Settlement Date` | `settlement_date` | differs from value date in some markets |
| `Debit`/`Credit`, `借`/`贷` | `dr` / `cr` | sign and amount direction must be paired; storing only the absolute value is forbidden |

> **needs human confirmation**: Local bank account structures per country, broker internal codes, and SWIFT MT version field differences are scattered across public specs; it is recommended to supplement them per concrete clearing bank actually connected.
