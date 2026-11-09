---
id: industry.retail
version: 1
scope: industry
field_types: [identifier, code, number]
regions: [global]
industries: [retail]
severity: error
direction: both
evidence: high
source: ["GS1 General Specifications v24", "GS1 GTIN check digit algorithm", "GS1 Application Identifiers"]
---

# Retail & GS1 Rule Pack

## 1. Applicable Scope

Product barcodes, logistics unit codes, store/location codes, and GS1-128 application identifiers.

**This is the most algorithmically deterministic category in the library**: GS1 check-digit definitions are public, stable, and globally unique.

## 2. Validation / Normalization Logic

**2.1 GTIN Unified Check Digit Algorithm (applies to GTIN-8/12/13/14)**

```
1. Starting from the digit immediately left of the check digit, moving right-to-left, apply weights 3, 1, 3, 1 ...
   (i.e. the digit adjacent to the check digit has weight 3)
2. Multiply each digit by its weight and sum into S
3. Check digit = (10 − (S mod 10)) mod 10
4. The check digit must equal the rightmost digit
```

**Mind the direction:** The alternating weights run "right-to-left, first weight 3". If implemented left-to-right, the parity of the total digit count flips the weights, causing half the codes to fail validation — the most common GS1 implementation bug.

**2.2 Length Specifications**

| Type | Digits | Common use | Regex |
| :--- | :--- | :--- | :--- |
| GTIN-8 | 8 | small packaging (EAN-8) | `^\d{8}$` |
| GTIN-12 | 12 | North America (UPC-A) | `^\d{12}$` |
| GTIN-13 | 13 | global retail (EAN-13) | `^\d{13}$` |
| GTIN-14 | 14 | case/pallet (ITF-14) | `^\d{14}$` |
| SSCC | 18 | logistics unit (pallet/case) | `^\d{18}$` |
| GLN | 13 | location code (store/warehouse) | `^\d{13}$` |

**Key:** When GTIN-12 and GTIN-13 represent the same product, they can be converted to each other by **left-padding with 0** (`012345678905` → normalized to 14 digits `00012345678905`). **Internal comparison must be unified to GTIN-14**, otherwise the same product is treated as two.

**2.3 GS1 Prefix (Company Prefix)**

The GS1 prefix is assigned globally by GS1 to identify a company. Common ranges:

| Prefix | Region |
| :--- | :--- |
| `000`–`139` | United States / Canada |
| `300`–`379` | France |
| `400`–`440` | Germany |
| `450`–`459`, `490`–`499` | Japan |
| `690`–`699` | China |
| `880` | South Korea |
| `885` | Thailand |
| `890` | India |
| `899` | Indonesia |
| `955` | Malaysia |

The prefix segment is only a **hint of origin** and cannot be used as a strong validation — cross-border production and imported goods often show a prefix that disagrees with the sales region.

**2.4 GS1-128 Application Identifiers (AI)**

| AI | Meaning | Format |
| :--- | :--- | :--- |
| `00` | SSCC | 18 digits |
| `01` | GTIN | 14 digits |
| `02` | contained product GTIN | 14 digits |
| `10` | batch number | up to 20 alphanumeric |
| `11` | production date | `YYMMDD` |
| `17` | expiry date | `YYMMDD` |
| `20` | variant | 2 digits |
| `21` | serial number | up to 20 digits |
| `30` | quantity | up to 8 digits |
| `310n` | net weight (kg) | n is the number of decimal places |
| `400` | order number | up to 30 digits |
| `410` | consignee GLN | 13 digits |
| `420` | postal code | up to 20 digits |

AIs in a message are **variable-length encoded** (some AIs are fixed length, some require an FNC1 separator to terminate). They cannot be simply split by position when parsing.

**2.5 Date Format (GS1-specific)**

`YYMMDD`, **no century**. Parsing rule: `00–49` → `20xx`, `50–99` → `19xx` (GS1 convention). This differs from the common two-digit year rule (70 boundary); **in retail scenarios the GS1 50 boundary must be used**.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `4006381333931` | valid (EAN-13) | check digit passes |
| `4006381333932` | reject | check digit error |
| `400638133393` | `"0400638133393"` or interpret as GTIN-12 | length ambiguity, needs context |
| `012345678905 (GTIN-12)` | `00012345678905 (GTIN-14)` | normalize to internal unified length |
| `12345678905 (lost leading 0)` | reject and warn | typical Excel corruption |
| `6901234567892` | valid (Chinese prefix) | |
| `SSCC 123456789012345678` | valid (if check passes) | 18 digits |
| `12345` | reject | insufficient length |
| `4006381333931 ` | `4006381333931` | trailing space |
| AI `17` = `240131` | expiry 2024-01-31 | GS1 two-digit year 50 boundary |
| AI `17` = `990131` | expiry 1999-01-31 | same as above |
| `(01)4006381333931(17)240131` | parse into two AIs | parentheses are human-readable form; storage must split into fields |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `EAN`, `EAN13`, `条形码`, `条码` | `gtin13` | EAN-13 is the former name of GTIN-13 |
| `UPC`, `UPC-A` | `gtin12` | |
| `ITF-14`, `箱码` | `gtin14` | |
| `SSCC`, `托盘码` | `sscc` | 18 digits |
| `GLN`, `位置码` | `gln` | 13 digits |
| `SKU`, `商品编码` | **not a GS1 code** | internal code, differs from GTIN, cannot be merged |
| `ASIN` | Amazon-internal identifier | differs from GTIN |
| `批次号` / `序列号` | `lot` / `serial` | AI 10 / 21, must not be mixed |
| `生产日期` / `有效期` | `production_date` / `expiry_date` | AI 11 / 17 |

> **needs human confirmation**: The GS1 prefix ranges and the full AI table (~500 entries) are revised over time; it is recommended to maintain them via official GS1 data files. This pack only defines the validation algorithm and high-frequency AIs.
