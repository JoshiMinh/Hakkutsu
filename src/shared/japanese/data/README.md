# Offline Hán-Việt readings

`hanviet-unihan.json` is generated from the Unicode 17.0.0 Unihan database's `kVietnamese` properties. Unambiguous `kTraditionalVariant` relationships fill simplified/shinjitai gaps only when all target variants have the same reading. The first listed reading is used where the source lists alternatives. Common Japanese readings in `hanviet-dict.ts` override this base where appropriate.

- Source: https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip
- Archive SHA-256: `F7A48B2B545ACFAA77B2D607AE28747404CE02BAEFEE16396C5D2D7A8EF34B5E`
- Property documentation: https://www.unicode.org/reports/tr38/#kVietnamese
- License: [Unicode License V3](../../../../licenses/UNICODE-LICENSE.txt)
- Generated coverage: 9,248 code points, including unambiguous traditional variants.

Regenerate using PowerShell:

```powershell
./scripts/generate-hanviet.ps1 -Archive /path/to/Unihan.zip
```

Readings are bundled; using Hán-Việt does not trigger a network request. Compounds with an uncovered Han character do not display a misleading partial reading. Complete readings already supplied by a dictionary or saved by the user remain available through `resolveHanViet`.

The generated base is not exhaustive for Japanese kanji. Verified overrides in `hanviet-dict.ts` include `棄 → KHÍ` and the Japanese variant `却 → KHƯỚC`; regression tests cover `破棄` and `棄却` along with the earlier screenshot cases.
