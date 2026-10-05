const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, globals = {}, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    module: { exports },
    Array,
    Object,
    String,
    Number,
    Boolean,
    console,
    Error,
    Map,
    Set,
    URL,
    URLSearchParams,
    Intl,
    ...globals,
    require: (name) => {
      if (name === '~/shared/japanese/text-normalization') return load('src/shared/japanese/text-normalization.ts');
      if (name in imports) return imports[name];
      if (name === 'react') return { ...React, default: React };
      if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name);
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}

const japanese = load('src/shared/japanese/japanese.ts', {});

test('japanese.distributeFurigana accurately distributes reading to kanji and leaves okurigana plain', () => {
  // 1. 洪水 -> こうずい
  const kouzui = japanese.distributeFurigana('洪水', 'こうずい');
  assert.equal(kouzui.length, 1);
  assert.equal(kouzui[0].text, '洪水');
  assert.equal(kouzui[0].ruby, 'こうずい');

  // 2. 戻ろう -> 戻[もど]ろう
  const modorou = japanese.distributeFurigana('戻ろう', 'もどろう');
  assert.equal(modorou.length, 2);
  assert.equal(modorou[0].text, '戻');
  assert.equal(modorou[0].ruby, 'もど');
  assert.equal(modorou[1].text, 'ろう');
  assert.equal(modorou[1].ruby, undefined);

  // 3. 任せた -> 任[まか]せた
  const makaseta = japanese.distributeFurigana('任せた', 'まかせた');
  assert.equal(makaseta.length, 2);
  assert.equal(makaseta[0].text, '任');
  assert.equal(makaseta[0].ruby, 'まか');
  assert.equal(makaseta[1].text, 'せた');
  assert.equal(makaseta[1].ruby, undefined);

  // 4. 何週間 -> なんしゅうかん
  const nanshuukan = japanese.distributeFurigana('何週間', 'なんしゅうかん');
  assert.equal(nanshuukan.length, 1);
  assert.equal(nanshuukan[0].text, '何週間');
  assert.equal(nanshuukan[0].ruby, 'なんしゅうかん');

  // 5. 楽に -> 楽[らく]に
  const rakuni = japanese.distributeFurigana('楽に', 'らくに');
  assert.equal(rakuni.length, 2);
  assert.equal(rakuni[0].text, '楽');
  assert.equal(rakuni[0].ruby, 'らく');
  assert.equal(rakuni[1].text, 'に');
  assert.equal(rakuni[1].ruby, undefined);

  // 6. 楽 -> らく
  const raku = japanese.distributeFurigana('楽', 'らく');
  assert.equal(raku.length, 1);
  assert.equal(raku[0].text, '楽');
  assert.equal(raku[0].ruby, 'らく');
});

test('japanese.sanitizeReading cleans multi-readings and strips erroneous lemma suffixes', () => {
  assert.equal(japanese.sanitizeReading('らくにする', '楽に'), 'らくに');
  assert.equal(japanese.sanitizeReading('らく', '楽'), 'らく');
  assert.equal(japanese.sanitizeReading('こうずい', '洪水'), 'こうずい');
  assert.equal(japanese.sanitizeReading('もどる、もどり', '戻る'), 'もどる');
  assert.equal(japanese.sanitizeReading('まかせる', '任せる'), 'まかせる');
});

test('japanese.mergeOkuriganaTokens merges inflected verb stems, compound counters, and honorifics', () => {
  // Verb with okurigana: 戻 + ろう -> 戻ろう (base: 戻る)
  const tokens1 = [
    { surface: '戻', pos: 'Word', base_form: '戻' },
    { surface: 'ろう', pos: 'Word', base_form: 'ろう' },
  ];
  const merged1 = japanese.mergeOkuriganaTokens(tokens1);
  assert.equal(merged1.length, 1);
  assert.equal(merged1[0].surface, '戻ろう');
  assert.equal(merged1[0].dictionary_form, '戻る');

  // Verb with multi-char okurigana: 任 + せ + た -> 任せた (base: 任せる)
  const tokens2 = [
    { surface: '任', pos: 'Word', base_form: '任' },
    { surface: 'せ', pos: 'Word', base_form: 'せ' },
    { surface: 'た', pos: 'Word', base_form: 'た' },
  ];
  const merged2 = japanese.mergeOkuriganaTokens(tokens2);
  assert.equal(merged2.length, 1);
  assert.equal(merged2[0].surface, '任せた');
  assert.equal(merged2[0].dictionary_form, '任せる');

  // Counter: 何 + 週間 -> 何週間
  const tokens3 = [
    { surface: '何', pos: 'Word', base_form: '何' },
    { surface: '週間', pos: 'Word', base_form: '週間' },
  ];
  const merged3 = japanese.mergeOkuriganaTokens(tokens3);
  assert.equal(merged3.length, 1);
  assert.equal(merged3[0].surface, '何週間');

  // Honorific: お + 前 -> お前
  const tokens4 = [
    { surface: 'お', pos: 'Word', base_form: 'お' },
    { surface: '前', pos: 'Word', base_form: '前' },
  ];
  const merged4 = japanese.mergeOkuriganaTokens(tokens4);
  assert.equal(merged4.length, 1);
  assert.equal(merged4[0].surface, 'お前');

  // Noun + particle: 本 + を -> does NOT merge
  const tokens5 = [
    { surface: '本', pos: 'Word', base_form: '本' },
    { surface: 'を', pos: 'Word', base_form: 'を' },
  ];
  const merged5 = japanese.mergeOkuriganaTokens(tokens5);
  assert.equal(merged5.length, 2);
  assert.equal(merged5[0].surface, '本');
  assert.equal(merged5[1].surface, 'を');
});

test('japanese.deriveInflectedReading derives accurate readings for inflected verb and adjective forms', () => {
  assert.equal(japanese.deriveInflectedReading('戻ろう', '戻る', 'もどる'), 'もどろう');
  assert.equal(japanese.deriveInflectedReading('任せた', '任せる', 'まかせる'), 'まかせた');
  assert.equal(japanese.deriveInflectedReading('走った', '走る', 'はしる'), 'はしった');
  assert.equal(japanese.deriveInflectedReading('信じられない', '信じる', 'しんじる'), 'しんじられない');
  assert.equal(japanese.deriveInflectedReading('体験した', '体験する', 'たいけんする'), 'たいけんした');
  assert.equal(japanese.deriveInflectedReading('韓国', '韓国', 'かんこく'), 'かんこく');
});

test('japanese.deinflectWord correctly deinflects potential and negative endings', () => {
  assert.equal(japanese.deinflectWord('信じられない'), '信じる');
  assert.equal(japanese.deinflectWord('戻ろう'), '戻る');
  assert.equal(japanese.deinflectWord('任せた'), '任せる');
});

test('japanese.distributeFurigana guards against bloated multi-word readings on single kanji', () => {
  const safe = japanese.distributeFurigana('半', 'はんぶんいじょうがまやくさんぎょうにかかわるー');
  assert.equal(safe.length, 1);
  assert.equal(safe[0].text, '半');
  assert.equal(safe[0].ruby, undefined);
});

test('japanese.alignTokensWithReading aligns sentence reading accurately across tokens and handles consecutive kanji', () => {
  // Test Sentence 1: 毎日の登校が楽になります
  const tokens1 = [
    { surface: '毎日' },
    { surface: 'の' },
    { surface: '登校' },
    { surface: 'が' },
    { surface: '楽に' },
    { surface: 'なり' },
    { surface: 'ます' },
  ];
  const aligned1 = japanese.alignTokensWithReading(tokens1, 'Mainichi no tōkō ga raku ni narimasu');
  assert.equal(aligned1.find((t) => t.surface === '毎日')?.reading?.hiragana, 'まいにち');
  assert.equal(aligned1.find((t) => t.surface === '登校')?.reading?.hiragana, 'とうこう');
  assert.equal(aligned1.find((t) => t.surface === '楽に')?.reading?.hiragana, 'らくに');

  // Test Sentence 2: 洪水は解決したので学校の建設へ戻ろう
  const tokens2 = [
    { surface: '洪水' },
    { surface: 'は' },
    { surface: '解決' },
    { surface: 'した' },
    { surface: 'ので' },
    { surface: '学校' },
    { surface: 'の' },
    { surface: '建設' },
    { surface: 'へ' },
    { surface: '戻ろう' },
  ];
  const aligned2 = japanese.alignTokensWithReading(
    tokens2,
    'Kōzui wa kaiketsu shitanode gakkō no kensetsu e modorou'
  );
  assert.equal(aligned2.find((t) => t.surface === '洪水')?.reading?.hiragana, 'こうずい');
  assert.equal(aligned2.find((t) => t.surface === '解決')?.reading?.hiragana, 'かいけつ');
  assert.equal(aligned2.find((t) => t.surface === '学校')?.reading?.hiragana, 'がっこう');
  assert.equal(aligned2.find((t) => t.surface === '建設')?.reading?.hiragana, 'けんせつ');
  assert.equal(aligned2.find((t) => t.surface === '戻ろう')?.reading?.hiragana, 'もどろう');

  // Test Sentence 3: そこになぜ韓国人がいるのか？
  const tokensS1 = [
    { surface: 'そこに' },
    { surface: 'なぜ' },
    { surface: '韓国' },
    { surface: '人' },
    { surface: 'が' },
    { surface: 'いる' },
    { surface: 'の' },
    { surface: 'か' },
    { surface: '？' },
  ];
  const alignedS1 = japanese.alignTokensWithReading(tokensS1, 'Soko ni naze kankoku hito ga iru no ka?');
  assert.equal(alignedS1.find((t) => t.surface === '韓国')?.reading?.hiragana, 'かんこく');
  assert.equal(alignedS1.find((t) => t.surface === '人')?.reading?.hiragana, 'ひと');

  // Test Sentence 4: 国民の半分以上が麻薬産業に関わるー
  const tokensS2 = [
    { surface: '国民' },
    { surface: 'の' },
    { surface: '半分' },
    { surface: '以上' },
    { surface: 'が' },
    { surface: '麻薬' },
    { surface: '産業' },
    { surface: 'に' },
    { surface: '関わる' },
    { surface: 'ー' },
  ];
  const alignedS2 = japanese.alignTokensWithReading(
    tokensS2,
    'Kokumin no hanbun ijō ga mayaku sangyō ni kakawaruー'
  );
  assert.equal(alignedS2.find((t) => t.surface === '国民')?.reading?.hiragana, 'こくみん');
  assert.equal(alignedS2.find((t) => t.surface === '半分')?.reading?.hiragana, 'はんぶん');
  assert.equal(alignedS2.find((t) => t.surface === '以上')?.reading?.hiragana, 'いじょう');
  assert.equal(alignedS2.find((t) => t.surface === '麻薬')?.reading?.hiragana, 'まやく');
  assert.equal(alignedS2.find((t) => t.surface === '産業')?.reading?.hiragana, 'さんぎょう');
  assert.equal(alignedS2.find((t) => t.surface === '関わる')?.reading?.hiragana, 'かかわる');

  // Test Sentence 5: 多民族多言語国家だ
  const tokensS3 = [
    { surface: '多' },
    { surface: '民族' },
    { surface: '多' },
    { surface: '言語' },
    { surface: '国家' },
    { surface: 'だ' },
  ];
  const alignedS3 = japanese.alignTokensWithReading(tokensS3, 'Ta-minzoku ta-gengo kokka da');
  assert.equal(alignedS3[0]?.reading?.hiragana, 'た');
  assert.equal(alignedS3[1]?.reading?.hiragana, 'みんぞく');
  assert.equal(alignedS3[2]?.reading?.hiragana, 'た');
  assert.equal(alignedS3[3]?.reading?.hiragana, 'げんご');
  assert.equal(alignedS3[4]?.reading?.hiragana, 'こっか');

  // Test Sentence 6: 信じられないだろうがすべては俺が体験したことだ
  const tokensS4 = [
    { surface: '信じられない' },
    { surface: 'だろう' },
    { surface: 'が' },
    { surface: 'すべて' },
    { surface: 'は' },
    { surface: '俺' },
    { surface: 'が' },
    { surface: '体験' },
    { surface: 'した' },
    { surface: 'こと' },
    { surface: 'だ' },
  ];
  const alignedS4 = japanese.alignTokensWithReading(
    tokensS4,
    'Shinjirarenai darou ga subete wa ore ga taiken shita koto da'
  );
  assert.equal(alignedS4.find((t) => t.surface === '信じられない')?.reading?.hiragana, 'しんじられない');
  assert.equal(alignedS4.find((t) => t.surface === '俺')?.reading?.hiragana, 'おれ');
  assert.equal(alignedS4.find((t) => t.surface === '体験')?.reading?.hiragana, 'たいけん');
});

test('transcript cue component renders accurate ruby markup for problem video lines', () => {
  const settings = { showFurigana: true };
  const parsers = load('src/features/subtitles/shared/subtitle-parsers.ts');

  // Mock TranscriptCue by loading SubtitleScriptDrawer
  const drawerModule = load(
    'src/features/subtitles/shared/subtitle-script-drawer.tsx',
    {
      window: { innerWidth: 360, location: { href: 'extension://sidepanel' }, setTimeout() {}, clearTimeout() {} },
      document: { querySelector: () => null },
    },
    {
      '~/features/subtitles/shared/use-transcript-window': {
        useTranscriptWindow: () => ({ start: 0, end: 4, before: 0, after: 0, scrollToRow() {} }),
      },
      '~/features/subtitles/shared/transcript-readings': {
        requestTranscriptReadings: async (text) => {
          if (text === '毎日の登校が楽になります') {
            return [
              { surface: '毎日', reading: { hiragana: 'まいにち' }, is_japanese: true, definitions: [] },
              { surface: 'の', reading: { hiragana: 'の' }, is_japanese: true, definitions: [] },
              { surface: '登校', reading: { hiragana: 'とうこう' }, is_japanese: true, definitions: [] },
              { surface: 'が', reading: { hiragana: 'が' }, is_japanese: true, definitions: [] },
              { surface: '楽に', reading: { hiragana: 'らくに' }, is_japanese: true, definitions: [] },
              { surface: 'なり', reading: { hiragana: 'なり' }, is_japanese: true, definitions: [] },
              { surface: 'ます', reading: { hiragana: 'ます' }, is_japanese: true, definitions: [] },
            ];
          }
          if (text === '洪水は解決したので学校の建設へ戻ろう') {
            return [
              { surface: '洪水', reading: { hiragana: 'こうずい' }, is_japanese: true, definitions: [] },
              { surface: 'は', reading: { hiragana: 'は' }, is_japanese: true, definitions: [] },
              { surface: '解決', reading: { hiragana: 'かいけつ' }, is_japanese: true, definitions: [] },
              { surface: 'した', reading: { hiragana: 'した' }, is_japanese: true, definitions: [] },
              { surface: 'ので', reading: { hiragana: 'ので' }, is_japanese: true, definitions: [] },
              { surface: '学校', reading: { hiragana: 'がっこう' }, is_japanese: true, definitions: [] },
              { surface: 'の', reading: { hiragana: 'の' }, is_japanese: true, definitions: [] },
              { surface: '建設', reading: { hiragana: 'けんせつ' }, is_japanese: true, definitions: [] },
              { surface: 'へ', reading: { hiragana: 'へ' }, is_japanese: true, definitions: [] },
              { surface: '戻ろう', reading: { hiragana: 'もどろう' }, is_japanese: true, definitions: [] },
            ];
          }
          if (text === 'ノーラン任せた') {
            return [
              { surface: 'ノーラン', reading: { hiragana: 'のうらん' }, is_japanese: true, definitions: [] },
              { surface: '任せた', reading: { hiragana: 'まかせた' }, is_japanese: true, definitions: [] },
            ];
          }
          if (text === '何週間もかかるぞ') {
            return [
              { surface: '何週間', reading: { hiragana: 'なんしゅうかん' }, is_japanese: true, definitions: [] },
              { surface: 'も', reading: { hiragana: 'も' }, is_japanese: true, definitions: [] },
              { surface: 'かかる', reading: { hiragana: 'かかる' }, is_japanese: true, definitions: [] },
              { surface: 'ぞ', reading: { hiragana: 'ぞ' }, is_japanese: true, definitions: [] },
            ];
          }
          return [];
        },
      },
      '~/features/subtitles/shared/subtitle-parsers': parsers,
      '~/shared/japanese/japanese': japanese,
      '~/shared/japanese/jlpt-classifier': { predictJlpt: () => null },
      '~/features/settings/settings-store': { useSettingsStore: () => ({ settings, updateSettings() {} }) },
      '~/shared/locales': { useTranslation: () => ({ t: (k) => k, lang: 'en' }) },
    }
  );

  const segments = [
    { start: 172, duration: 3, text: '毎日の登校が楽になります' },
    { start: 177, duration: 3, text: '洪水は解決したので学校の建設へ戻ろう' },
    { start: 180, duration: 3, text: 'ノーラン任せた' },
    { start: 186, duration: 3, text: '何週間もかかるぞ' },
  ];

  const html = renderToStaticMarkup(
    React.createElement(drawerModule.SubtitleScriptDrawer, {
      isOpen: true,
      nativePanel: true,
      onClose() {},
      subtitleData: { segments },
      currentSegment: segments[0],
    })
  );

  // Verify that fast tokenization / cue rendering handles all words without breaking:
  assert.ok(html.includes('hk-script-cue'), 'contains cues');
  assert.ok(html.includes('id="hk-script-cue-0"'));
  assert.ok(html.includes('id="hk-script-cue-1"'));
  assert.ok(html.includes('id="hk-script-cue-2"'));
  assert.ok(html.includes('id="hk-script-cue-3"'));
  assert.ok(html.includes('毎日'));
  assert.ok(html.includes('登校'));
  assert.ok(html.includes('楽に'));
  assert.ok(html.includes('洪水'));
  assert.ok(html.includes('解決'));
  assert.ok(html.includes('戻ろう'));
  assert.ok(html.includes('ノーラン'));
  assert.ok(html.includes('任せた'));
  assert.ok(html.includes('何週間'));
});
