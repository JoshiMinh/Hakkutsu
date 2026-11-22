# Offline Hán-Việt readings

`hanviet-unihan.json` uses Unicode 18.0.0 Unihan readings and fills gaps with readings from Thiều Chửu’s *Hán Việt tự điển*. The generator fills Japanese shinjitai and kyūjitai gaps using `kJapaneseOldVariant` and `kJapaneseNewVariant`, and uses `kTraditionalVariant` for simplified Chinese forms. A variant supplies a reading when all its targets have the same direct reading. The first listed reading is used where a source lists alternatives. Common Japanese readings in `hanviet-dict.ts` override this base where appropriate.

- [Unicode 18.0.0 Unihan archive](https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip) under the [Unicode License V3](../../../../licenses/UNICODE-LICENSE.txt).
- [Thiều Chửu’s dictionary, digitized by catusf/tudien](https://github.com/catusf/tudien/blob/a7dd918ecc67de8c2d15034f885d919b9295eba4/dict/TudienThienChuu.tab) under [CC0 1.0](https://github.com/catusf/tudien/blob/a7dd918ecc67de8c2d15034f885d919b9295eba4/LICENSE). Only character readings are used.
- Generated coverage includes 15,957 code points.

Regenerate using PowerShell:

```powershell
./scripts/generate-hanviet.ps1 -Archive /path/to/Unihan.zip -ThieuChuu /path/to/TudienThienChuu.tab
```

Readings are bundled; using Hán-Việt does not trigger a network request. Compounds with an uncovered Han character do not display a misleading partial reading. Complete readings already supplied by a dictionary or saved by the user remain available through `resolveHanViet`.
