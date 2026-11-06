const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./load-typescript.cjs");
const flush = () => new Promise(resolve => setImmediate(resolve));
const until = async condition => {
  const deadline = Date.now() + 4000;
  while (!condition()) { if (Date.now() > deadline) throw new Error("Preparation timed out"); await new Promise(resolve => setTimeout(resolve, 2)); }
};
const cue = (start, text, duration = 2) => ({ start, text, duration });

test("native subtitles share primary boundaries without borrowing translations across gaps", () => {
  const { pairSubtitleTracks } = loader()("src/features/subtitles/shared/subtitle-pairs.ts");
  const primary = [cue(0, "学校", 4), cue(4, "日本"), cue(10, "先生")];
  const secondary = [cue(0.2, "School", 1), cue(1.2, "today", 2.8), cue(4.1, "Japan"), cue(12, "Teacher")];
  const pairs = pairSubtitleTracks(primary, secondary);
  assert.equal(pairs.get(primary[0]), "School today");
  assert.equal(pairs.get(primary[1]), "Japan");
  assert.equal(pairs.get(primary[2]), "");
});

test("pairing a film processes the two complete tracks in linear time", () => {
  const { pairSubtitleTracks } = loader()("src/features/subtitles/shared/subtitle-pairs.ts");
  let reads = 0;
  const secondary = new Proxy(Array.from({length:10000}, (_, i) => cue(i*3+0.1, `translation ${i}`)), {
    get(target, key) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key); },
  });
  const primary = Array.from({length:10000}, (_, i) => cue(i*3, `source ${i}`));
  const result = pairSubtitleTracks(primary, secondary);
  assert.equal(result.get(primary[9999]), "translation 9999");
  assert.ok(reads < 150000, `${reads} secondary cue reads`);
});

test("YouTube prefers a native target track and otherwise downloads a full translated track", () => {
  const { chooseYouTubeSecondaryTrack } = loader()("src/features/subtitles/youtube/youtube-secondary-track.ts");
  const primary = {id:"ja",languageCode:"ja",name:"Japanese",url:"https://example.test/timedtext?v=film&tlang=ja&fmt=srv3"};
  const native = {id:"vi",languageCode:"vi-VN",name:"Vietnamese",url:"https://example.test/vi"};
  assert.equal(chooseYouTubeSecondaryTrack([primary,native], primary, "vi"), native);
  const translated = chooseYouTubeSecondaryTrack([primary], primary, "en");
  assert.equal(translated.id, "yt-auto-translate-en");
  assert.equal(new URL(translated.url).searchParams.get("tlang"), "en");
  assert.equal(new URL(translated.url).searchParams.get("v"), "film");
  assert.equal(chooseYouTubeSecondaryTrack([], undefined, "vi"), null);
});

test("preparation prioritizes current playback, prepares the whole track and deduplicates repeated lines", async () => {
  const sent = [];
  global.chrome = {runtime:{sendMessage:async message => {
    sent.push([message.type, message.payload.text]);
    if (message.type === "ANALYZE_TEXT") return {type:"ANALYZE_RESULT",payload:{tokens:[{surface:message.payload.text}]}};
    return {type:"TRANSLATE_RESULT",payload:{translation:`translated ${message.payload.text}`}};
  }}};
  const { createSubtitlePreparation } = loader()("src/features/subtitles/shared/subtitle-preparation.ts");
  const preparation = createSubtitlePreparation([cue(0,"学校"),cue(100,"日本"),cue(103,"先生"),cue(200,"学校")], "vi");
  preparation.setPosition(100);
  preparation.start({readings:true,translations:true});
  try {
    await until(() => sent.length === 6 && preparation.peekTranslation("学校"));
    assert.deepEqual(sent.slice(0,2), [["ANALYZE_TEXT","日本"],["TRANSLATE_TEXT","日本"]]);
    for (const type of ["ANALYZE_TEXT","TRANSLATE_TEXT"]) assert.deepEqual(sent.filter(row=>row[0]===type).map(row=>row[1]), ["日本","先生","学校"]);
    const count = sent.length;
    await preparation.getReadings("学校",{priority:1}); await preparation.getTranslation("学校",{priority:1});
    assert.equal(sent.length, count);
  } finally { preparation.stop(); }
});

test("track results survive more than 200 shared-cache entries and replay sends no requests", async () => {
  let count = 0;
  global.chrome = {runtime:{sendMessage:async message => {
    count++; return {type:"ANALYZE_RESULT",payload:{tokens:[{surface:message.payload.text}]}};
  }}};
  const { createSubtitlePreparation } = loader()("src/features/subtitles/shared/subtitle-preparation.ts");
  const track = Array.from({length:240}, (_, i) => cue(i*3, `学校 ${i}`));
  const preparation = createSubtitlePreparation(track,"vi");
  for (const segment of track) await preparation.getReadings(segment.text);
  await preparation.getReadings(track[0].text);
  assert.equal(count,240);
});

test("seeking supersedes queued background lines and stopping releases all subscribers", async () => {
  const sent = [], releases = [];
  global.chrome = {runtime:{sendMessage:message => new Promise(resolve => {
    sent.push(message.payload.text);
    releases.push(() => resolve({type:"ANALYZE_RESULT",payload:{tokens:[{surface:message.payload.text}]}}));
  })}};
  const load = loader();
  const { requestTranscriptReadings } = load("src/features/subtitles/shared/transcript-readings.ts");
  const { createSubtitlePreparation } = load("src/features/subtitles/shared/subtitle-preparation.ts");
  const first = requestTranscriptReadings("busy 1","vi"), second = requestTranscriptReadings("busy 2","vi");
  await flush();
  const preparation = createSubtitlePreparation([cue(0,"学校"),cue(100,"日本"),cue(200,"先生")],"vi");
  preparation.start({readings:true,translations:false});
  preparation.setPosition(200);
  releases[0](); await first; await flush();
  assert.deepEqual(sent,["busy 1","busy 2","先生"]);
  preparation.stop(); releases[1](); releases[2](); await second; await flush();
  assert.equal(sent.length,3);
});

test("translation cancellation leaves another subscriber live and failures remain retryable", async () => {
  let count=0, release;
  global.chrome = {runtime:{sendMessage:() => {count++; return new Promise(resolve=>release=resolve);}}};
  const { requestSubtitleTranslation } = loader()("src/features/subtitles/shared/subtitle-translations.ts");
  const controller = new AbortController();
  const abandoned = requestSubtitleTranslation("学校","vi",{signal:controller.signal}).catch(()=>null);
  const live = requestSubtitleTranslation("学校","vi");
  await flush(); controller.abort(); release({type:"TRANSLATE_RESULT",payload:{translation:"Trường học"}});
  await abandoned; assert.equal(await live,"Trường học"); assert.equal(count,1);
  global.chrome.runtime.sendMessage=async()=>({type:"ERROR"});
  await assert.rejects(requestSubtitleTranslation("先生","vi"),/unavailable/);
  global.chrome.runtime.sendMessage=async()=>({type:"TRANSLATE_RESULT",payload:{translation:"Giáo viên"}});
  assert.equal(await requestSubtitleTranslation("先生","vi"),"Giáo viên");
});

test("an interrupted background cursor revisits unfinished earlier cues after the seek window", async () => {
  const sent=[],releases=[];
  const { createSubtitlePreparation } = loader({
    "./transcript-readings":{requestTranscriptReadings:(text,language,{signal})=>{
      sent.push(text);
      return new Promise((resolve,reject)=>{releases.push(()=>resolve([{surface:text}]));signal.addEventListener("abort",()=>reject(signal.reason),{once:true});});
    }},
  })("src/features/subtitles/shared/subtitle-preparation.ts");
  const preparation=createSubtitlePreparation([cue(0,"earlier"),cue(100,"middle"),cue(200,"later")],"vi");
  preparation.setPosition(100);preparation.start({readings:true,translations:false});
  try {
    releases[0]();await until(()=>sent.length===2);assert.equal(sent[1],"earlier");
    preparation.setPosition(300);assert.equal(sent[2],"later");
    releases[2]();await until(()=>sent.length===4);assert.equal(sent[3],"earlier");
    releases[3]();await until(()=>!!preparation.peekReadings("earlier"));
  } finally {preparation.stop();}
});

test("temporary foreground queue pressure does not permanently skip background cues", async () => {
  let calls=0;
  const { createSubtitlePreparation } = loader({
    "./transcript-readings":{requestTranscriptReadings:async text=>{
      if (++calls===1) throw new Error("Subtitle preparation queue full");
      return [{surface:text}];
    }},
  })("src/features/subtitles/shared/subtitle-preparation.ts");
  const preparation=createSubtitlePreparation([cue(0,"学校")],"vi");
  preparation.start({readings:true,translations:false});
  try {await until(()=>!!preparation.peekReadings("学校"));assert.equal(calls,2);}
  finally {preparation.stop();}
});
