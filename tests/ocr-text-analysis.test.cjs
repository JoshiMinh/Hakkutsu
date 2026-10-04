const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Intl, ...globals, require: name => imports[name] || require(name) });
  return exports;
}
const constants = load('src/lib/utils/constants.ts');
const japanese = load('src/lib/utils/japanese.ts', { './constants': constants });
const { refineJapaneseTokens } = load('src/lib/services/japanese-token-refinement.ts', { '~lib/utils/japanese': japanese });
const raw = text => [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)].map(segment => ({
  surface_form: segment.segment, base_form: segment.segment, pos: segment.isWordLike ? 'Word' : 'Punctuation',
}));
const entry = (word, reading) => ({ kanjiElements: [word], readingElements: [reading], senses: [] });

test('OCR analysis joins a split compound verb and noun only when their dictionary lemmas are confirmed', async () => {
  const text = '取り逃がした凶悪犯から未来を-守れるのか9?・';
  const dictionary = { '取り逃がす': entry('取り逃がす', 'とりのがす'), '凶悪犯': entry('凶悪犯', 'きょうあくはん') };
  const original = raw(text);
  const result = await refineJapaneseTokens(original, async word => dictionary[word] ? [dictionary[word]] : []);
  assert.equal(result.map(token => token.surface_form).join(''), text);
  const verb = result.find(token => token.surface_form === '取り逃がした');
  assert.equal(verb.base_form, '取り逃がす');
  assert.equal(verb.reading, 'とりのがした');
  assert.equal(verb.dictionary_reading, 'とりのがす');
  assert.equal(result.find(token => token.surface_form === '凶悪犯').reading, 'きょうあくはん');
  assert.deepEqual(original, raw(text), 'Refinement must not mutate the source segmentation');
});

test('unavailable dictionaries and partial matches cannot invent words or remove OCR punctuation, numbers or line breaks', async () => {
  const text = '未来を-守る9?・\n第2話!';
  const original = raw(text);
  for (const lookup of [async () => [], async () => { throw Error('Dictionary unavailable'); }, async () => [entry('未来', 'みらい')]]) {
    const result = await refineJapaneseTokens(original, lookup);
    assert.equal(result.map(token => token.surface_form).join(''), text);
    assert.equal(result.some(token => /[-?・\n!\d]/.test(token.surface_form) && token.surface_form.length > 1), false);
    assert.equal(result.find(token => token.surface_form === '未来を'), undefined);
  }
});

test('sentence breakdown exposes native word buttons with aligned ruby and leaves punctuation unselectable', () => {
  const { TokenDisplay } = load('src/components/token-display.tsx', { '~lib/utils/japanese': japanese });
  const tokens = [
    { surface: '取り逃がした', dictionary_form: '取り逃がす', reading: { hiragana: 'とりのがした' }, pos: 'Word', is_japanese: true },
    { surface: '?9・', reading: { hiragana: '' }, is_japanese: false },
  ];
  const selections = [];
  const tree = TokenDisplay({ tokens, selectedIndex: 0, onSelect: index => selections.push(index), variant: 'sentence' });
  const children = React.Children.toArray(tree.props.children);
  assert.equal(children[0].type, 'button');
  assert.equal(children[0].props['aria-pressed'], true);
  children[0].props.onClick();
  assert.deepEqual(selections, [0]);
  assert.equal(children[1].type, 'span');
  assert.equal(children[1].props.onClick, undefined);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /<ruby>取<rt>と<\/rt><\/ruby>/);
  assert.match(html, /<ruby>逃<rt>の<\/rt><\/ruby>/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /\?9・/);
});

test('OCR phrase analysis passes refinement to the tokenizer, preserves junk as non-Japanese, and derives inflected readings', async () => {
  const seen = [], lookups = [];
  const { llmService } = load('src/lib/services/llm-service.ts', {
    '~lib/utils/settings': { useSettingsStore: {} }, './storage': {},
    './google-translate': { googleTranslateService: { translate: async () => 'Can you protect the future?' } },
    './local-tokenizer': { tokenize: async (text, options) => {
      seen.push(options);
      return [{ surface_form: '守れる', base_form: '守る', pos: 'Word' }, { surface_form: '9?・', base_form: '9?・', pos: 'Punctuation' }];
    } },
    './dictionary-lookup': { lookupWord: async word => { lookups.push(word); return { meaning: 'protect', reading: 'まもる' }; } },
    '~lib/utils/japanese': japanese,
    '~lib/utils/hanviet-dict': { getHanViet: () => '' }, '~lib/utils/jlpt-classifier': { predictJlpt: () => null },
  });
  const result = await llmService.analyzeText('守れる9?・', true, 'en', true);
  assert.equal(seen[0].dictionaryAware, true);
  assert.deepEqual(lookups, ['守る']);
  assert.equal(result.tokens[0].reading, 'まもれる');
  assert.equal(result.tokens[0].dictionary_reading, 'まもる');
  assert.equal(result.tokens[1].is_japanese, false);
  assert.equal(result.tokens[1].surface, '9?・');
  assert.equal(result.translation, 'Can you protect the future?');
});

test('selected definitions use the dictionary reading while the sentence retains its inflected reading', () => {
  const noop = () => {};
  const { DefinitionCard } = load('src/components/definition-card.tsx', {
    react: { ...React, useState: initial => [initial, noop], useEffect: noop, useRef: () => ({ current: null }) },
    '~lib/utils/constants': constants, '~lib/utils/japanese': japanese,
    '~lib/utils/hanviet-dict': { getHanViet: () => '' }, '~lib/utils/jlpt-classifier': { predictJlpt: () => null },
    './badges': { JlptBadge: () => null, PosBadge: () => null, FrequencyBadge: () => null },
    '~lib/locales': { useTranslation: () => ({ t: key => key, lang: 'en' }) },
    '~lib/services/tts-service': {}, '~lib/services/dictionary-lookup': {}, '~lib/services/irasutoya-service': {},
  });
  const token = { surface: '守れる', dictionary_form: '守る', reading: { hiragana: 'まもれる' },
    dictionary_reading: 'まもる', pos: 'Word', is_japanese: true, definitions: [{ glosses: ['protect'] }] };
  const html = renderToStaticMarkup(DefinitionCard({ token, originalText: '守れるのか？', hideBottomAction: true }));
  assert.match(html, /まもる/);
  assert.doesNotMatch(html, /まもれる/);
});

test('OCR and ordinary lookup requests do not share a cached tokenization', async () => {
  const requests = [];
  const { requestLookupAnalysis } = load('src/lib/services/lookup-analysis.ts', {}, {
    chrome: { runtime: { sendMessage: async message => {
      requests.push(message);
      return { type: 'ANALYZE_PHRASE_RESULT', payload: { text: message.payload.text } };
    } } },
  });
  await requestLookupAnalysis('ANALYZE_PHRASE', '取り逃がした', true, 'en');
  await requestLookupAnalysis('ANALYZE_PHRASE', '取り逃がした', true, 'en', 'ocr');
  await requestLookupAnalysis('ANALYZE_PHRASE', '取り逃がした', true, 'en', 'ocr');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].payload.source, 'ocr');
});

test('OCR tokenization skips compound queries when the local dictionary is not installed', async () => {
  let queries = 0;
  const { tokenize } = load('src/lib/services/local-tokenizer.ts', {
    '~lib/utils/japanese': japanese,
    './japanese-token-refinement': { refineJapaneseTokens },
    './local-lookup': { getDB: async () => ({ objectStoreNames: { contains: () => false } }),
      searchDictionary: async () => { queries++; return []; } },
  });
  const text = '未来を守れるのか9?・';
  const tokens = await tokenize(text, { dictionaryAware: true });
  assert.equal(tokens.map(token => token.surface_form).join(''), text);
  assert.equal(queries, 0);
});
