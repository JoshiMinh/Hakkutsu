const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Intl, console, AbortController, setTimeout, clearTimeout,
    ...globals, require: name => {
      if (imports[name]) return imports[name];
      if (name.startsWith('~/')) return load(`src/${name.slice(2)}.ts`, imports, globals);
      if (name.startsWith('./')) return load(path.join(path.dirname(file), `${name}.ts`), imports, globals);
      return require(name);
    } });
  return exports;
}
const japanese = load('src/shared/japanese/japanese.ts');
const refinement = load('src/features/dictionary/japanese-token-refinement.ts', { '~/shared/japanese/japanese': japanese });
const entry = (word, reading) => ({ kanjiElements: [word], readingElements: [reading], senses: [] });

function dictionaryService(data, requests = []) {
  return load('src/features/dictionary/dictionary-lookup.ts', {
    '~/shared/japanese/japanese': japanese,
    '~/shared/japanese/hanviet-dict': { getHanViet: () => '' },
    './google-translate': { googleTranslateService: { translateWithReading: async () => ({ translation: '', reading: '' }) } },
  }, { fetch: async (url, options) => {
    requests.push(options?.body ? JSON.parse(options.body).query : new URL(url).searchParams.get('keyword'));
    return { ok: true, json: async () => data };
  } });
}

function subtitleBackground(extraEntries = {}) {
  const localEntries = { 人: entry('人', 'ひと'), 店: entry('店', 'みせ'), 物: entry('物', 'もの'), 全部: entry('全部', 'ぜんぶ'), ...extraEntries };
  const local = { searchDictionary: async word => localEntries[word] ? [localEntries[word]] : [],
    getDB: async () => ({ objectStoreNames: { contains: () => false } }) };
  const tokenizer = load('src/features/dictionary/local-tokenizer.ts', {
    '~/shared/japanese/japanese': japanese, './japanese-token-refinement': refinement, './local-lookup': local,
  });
  const requests = [];
  // Reproduce the dictionary's related search hit that caused たべもの on 食べ.
  const dictionary = dictionaryService({ data: [{ slug: '食べ物', japanese: [{ word: '食べ物', reading: 'たべもの' }],
    senses: [{ english_definitions: ['food'] }] }] }, requests);
  let listener;
  const chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  const imports = {
    '~/features/settings/settings-storage': { getSettings: async () => ({ targetLanguage: 'en' }) },
    '~/features/dictionary/api-client': { apiClient: { analyzePhrase: async () => { throw Error('Offline'); } } },
    '~/features/dictionary/local-tokenizer': tokenizer, '~/features/dictionary/local-lookup': local,
    '~/features/dictionary/dictionary-lookup': dictionary, '~/shared/japanese/japanese': japanese,
    '~/shared/japanese/hanviet-dict': { getHanViet: () => '' }, '~/shared/japanese/jlpt-classifier': { predictJlpt: () => null },
    '~/features/subtitles/shared/transcript-panel-router': { installTranscriptPanelRouter: () => () => {} },
  };
  for (const name of ['llm-service', 'google-translate', 'irasutoya-service']) {
    imports['~/features/dictionary/' + name] = {};
  }
  imports['~/features/anki/anki-connect'] = {};
  imports['~/features/srs/local-srs'] = {};
  imports['~/features/subtitles/shared/subtitle-parsers'] = {};
  imports['~/features/analytics/analytics-service'] = {};
  const background = load('src/app/background.ts', imports, { chrome, console: { warn() {} } });
  load('src/entrypoints/background.ts', { '~/app/background': background }, { defineBackground: fn => fn() });
  return { tokenizer, requests, analyze: (text, includeDefinitions = false) => new Promise(resolve => {
    assert.equal(listener({ type: 'ANALYZE_TEXT', payload: { text, include_definitions: includeDefinitions } }, {}, resolve), true);
  }) };
}

test('subtitle message routing reads the screenshot sentence correctly despite unrelated dictionary hits', async () => {
  const background = subtitleBackground();
  const text = 'この４人が店の物を全部食べたら';
  const { TokenDisplay } = load('src/features/dictionary/token-display.tsx', { '~/shared/japanese/japanese': japanese });
  for (const includeDefinitions of [false, true]) {
    const response = await background.analyze(text, includeDefinitions);
    assert.equal(response.type, 'ANALYZE_RESULT');
    const tokens = response.payload.tokens;
    assert.equal(tokens.map(token => token.surface).join(''), text);
    const counter = tokens.find(token => token.surface === '４人');
    assert.equal(counter.reading.hiragana, 'よにん');
    const verb = tokens.find(token => token.surface === '食べ');
    assert.equal(verb.dictionary_form, '食べる');
    assert.equal(verb.reading.hiragana, 'たべ');
    const html = renderToStaticMarkup(TokenDisplay({ tokens, selectedIndex: -1, onSelect() {}, variant: 'sentence' }));
    assert.match(html, /<ruby>４人<rt>よにん<\/rt><\/ruby>/);
    assert.match(html, /<ruby>食<rt>た<\/rt><\/ruby>/);
    assert.doesNotMatch(html, /たべもの|<ruby>べ|<ruby>たら/);
  }
  assert.equal(background.requests.includes('食'), false, 'Resolve the verb lemma before querying a bare kanji stem');
});

test('people counter readings work for ASCII, full-width and kanji numerals without changing ordinary 人', async () => {
  const background = subtitleBackground();
  for (const [text, reading] of [['1人', 'ひとり'], ['２人', 'ふたり'], ['三人', 'さんにん'], ['四人', 'よにん'],
    ['7人', 'しちにん'], ['10人', 'じゅうにん'], ['14人', 'じゅうよにん'], ['二十四人', 'にじゅうよにん']]) {
    const response = await background.analyze(text + 'がいる');
    const counter = response.payload.tokens.find(token => token.surface === text);
    assert.equal(counter?.reading.hiragana, reading, text);
    assert.equal(japanese.distributeFurigana(text, reading)[0].ruby, reading);
  }
  const person = await background.analyze('この人がいる');
  assert.equal(person.payload.tokens.find(token => token.surface === '人').reading.hiragana, 'ひと');
  for (const text of ['人', '人気', '四人組', '3 人', '百人', '人々']) assert.equal(japanese.getPeopleCounterReading(text), '', text);
});

test('immediate subtitle tokens and analyzed tokens agree on counters and preserve source tokens', () => {
  const original = ['この', '４', '人', 'が'].map(surface => ({ surface, dictionary_form: surface,
    pos: 'Word', is_japanese: japanese.containsJapanese(surface), reading: { hiragana: '', romaji: '' } }));
  const merged = japanese.mergeOkuriganaTokens(original);
  assert.equal(merged.map(token => token.surface).join(''), 'この４人が');
  assert.equal(merged[1].reading.hiragana, 'よにん');
  assert.equal(merged[1].is_japanese, true);
  assert.equal(original[1].surface, '４');
  assert.equal(original[1].reading.hiragana, '');
});

test('whole-word local lookup uses the contextual counter reading too', async () => {
  const background = subtitleBackground({ '４人': entry('４人', 'よんにん') });
  const response = await background.analyze('４人');
  assert.equal(response.payload.tokens.length, 1);
  assert.equal(response.payload.tokens[0].reading.hiragana, 'よにん');
});

test('ruby alignment handles repeated kana, katakana, iteration marks and punctuation', () => {
  for (const [surface, reading, expected] of [
    ['聞き返す', 'ききかえす', [['聞', 'き'], ['き'], ['返', 'かえ'], ['す']]],
    ['引っ越し', 'ヒッコシ', [['引', 'ひ'], ['っ'], ['越', 'こ'], ['し']]],
    ['時々', 'ときどき', [['時々', 'ときどき']]],
    ['食べたら！', 'たべたら', [['食', 'た'], ['べたら！']]],
    [' 食べたら！ ', 'たべたら', [[' '], ['食', 'た'], ['べたら！ ']]],
  ]) {
    const ruby = japanese.distributeFurigana(surface, reading);
    assert.equal(ruby.map(segment => segment.text).join(''), surface);
    assert.equal(JSON.stringify(ruby.map(segment => segment.ruby ? [segment.text, segment.ruby] : [segment.text])), JSON.stringify(expected));
  }
  for (const [surface, reading] of [['食べ', 'たべもの'], ['食べたら', 'たべる'], ['戻る', 'もどり'], ['引っ越し', 'x']]) {
    const ruby = japanese.distributeFurigana(surface, reading);
    assert.equal(ruby.map(segment => segment.text).join(''), surface);
    assert.equal(ruby.some(segment => segment.ruby), false);
  }
  assert.equal(japanese.deriveInflectedReading('食べ', '食べ物', 'たべもの'), '');
  assert.equal(japanese.deriveInflectedReading('食べた', '食べる', 'たべもの'), '');
  assert.equal(japanese.sanitizeReading('どきどき', '動悸'), 'どきどき');
});

test('dictionary search hits cannot attach readings from a different English headword', async () => {
  const dictionary = dictionaryService({ data: [{ slug: '食べ物', japanese: [{ word: '食べ物', reading: 'たべもの' }],
    senses: [{ english_definitions: ['food'] }] }] });
  assert.equal((await dictionary.lookupWordEnglish('食べ')).reading, undefined);
  assert.equal((await dictionary.lookupWordEnglish('食べ物')).reading, 'たべもの');
});

test('Mazii adapters only supply readings for matching Vietnamese, Chinese and Korean headwords', async () => {
  const dictionary = dictionaryService({ status: 200, data: [{ word: '食べ物', phonetic: 'たべもの', means: [{ mean: 'food' }] }] });
  for (const lookup of [dictionary.lookupWordVietnamese, dictionary.lookupWordChinese, dictionary.lookupWordKorean]) {
    assert.equal((await lookup('食べ')).reading, '');
    assert.equal((await lookup('食べ物')).reading, 'たべもの');
  }
});
