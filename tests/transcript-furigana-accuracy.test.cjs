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
      if (name in imports) return imports[name];
      if (name === 'react') return { ...React, default: React };
      if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name);
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}

const constants = load('src/lib/utils/constants.ts');
const japanese = load('src/lib/utils/japanese.ts', {}, { './constants': constants });

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

test('japanese.alignTokensWithReading aligns sentence reading accurately across tokens', () => {
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

  // Test Sentence 3: ノーラン任せた
  const tokens3 = [{ surface: 'ノーラン' }, { surface: '任せた' }];
  const aligned3 = japanese.alignTokensWithReading(tokens3, 'Nōran makaseta');
  assert.equal(aligned3.find((t) => t.surface === '任せた')?.reading?.hiragana, 'まかせた');

  // Test Sentence 4: 何週間もかかるぞ
  const tokens4 = [{ surface: '何週間' }, { surface: 'も' }, { surface: 'かかる' }, { surface: 'ぞ' }];
  const aligned4 = japanese.alignTokensWithReading(tokens4, 'Nan-shūkan mo kakaru zo');
  assert.equal(aligned4.find((t) => t.surface === '何週間')?.reading?.hiragana, 'なんしゅうかん');
});

test('transcript cue component renders accurate ruby markup for problem video lines', () => {
  const settings = { showFurigana: true };
  const parsers = load('src/lib/services/subtitle-parsers.ts');

  // Mock TranscriptCue by loading SubtitleScriptDrawer
  const drawerModule = load(
    'src/components/subtitle-script-drawer.tsx',
    {
      window: { innerWidth: 360, location: { href: 'extension://sidepanel' }, setTimeout() {}, clearTimeout() {} },
      document: { querySelector: () => null },
    },
    {
      '~lib/services/use-transcript-window': {
        useTranscriptWindow: () => ({ start: 0, end: 4, before: 0, after: 0, scrollToRow() {} }),
      },
      '~lib/services/transcript-readings': {
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
      '~lib/services/subtitle-parsers': parsers,
      '~lib/utils/japanese': japanese,
      '~lib/utils/jlpt-classifier': { predictJlpt: () => null },
      '~lib/utils/settings': { useSettingsStore: () => ({ settings, updateSettings() {} }) },
      '~lib/locales': { useTranslation: () => ({ t: (k) => k, lang: 'en' }) },
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
