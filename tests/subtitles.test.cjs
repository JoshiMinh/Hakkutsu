const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {loader} = require("./load-typescript.cjs");
const load = loader();
const {findSmartCueIndex, smartCueEnd} = load("src/features/subtitles/shared/smart-cue.ts");
const {retainSubtitleCue} = load("src/features/subtitles/shared/cue-state.ts");
const flush = () => new Promise(resolve => setImmediate(resolve));

test("cue lookup preserves boundaries, gaps, overlaps, seeks, and long cues", () => {
  const cues = [{start:1,duration:4,text:"one"},{start:3,duration:1,text:"two。"},{start:9,duration:0,text:"three"},{start:12,duration:150,text:"long"}];
  for (let time = -1; time <= 175; time += 0.03125) {
    let expected = -1;
    for (let index = 0; index < cues.length; index++) if (time >= cues[index].start && time <= smartCueEnd(cues,index)) expected = index;
    assert.equal(findSmartCueIndex(cues,time),expected,`time ${time}`);
  }
  assert.equal(findSmartCueIndex([],0),-1);
  assert.equal(findSmartCueIndex(cues,90),3);
});

test("long subtitle gaps use logarithmic cue reads instead of rescanning the track", () => {
  let reads = 0;
  const cues = Array.from({length:10000},(_,index)=>({start:index/1000,duration:0.0001,text:"caption"}));
  const watched = new Proxy(cues,{get(target,key){if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target,key);}});
  const start = performance.now();
  for (let tick=0;tick<500;tick++) assert.equal(findSmartCueIndex(watched,40),-1);
  const result = {case:"10000 cues, 500 ticks in a subtitle gap",milliseconds:performance.now()-start,cueReads:reads};
  assert.ok(reads < 20000,`${reads} cue reads`);
  fs.mkdirSync("test-results",{recursive:true});
  fs.writeFileSync("test-results/subtitle-optimized.json",JSON.stringify(result,null,2));
});

test("fresh native cue objects retain identity until their text or timing changes", () => {
  const cue = {start:1,duration:2,text:"学校"};
  assert.equal(retainSubtitleCue(cue,{...cue}),cue);
  assert.notEqual(retainSubtitleCue(cue,{...cue,text:"日本"}),cue);
  assert.notEqual(retainSubtitleCue(cue,{...cue,duration:3}),cue);
  assert.equal(retainSubtitleCue(cue,null),null);
});

class FrameVideo extends EventTarget {
  paused=false; ended=false; currentTime=0; sequence=0;
  frames=new Map(); added=0; removed=0;
  addEventListener(...args){this.added++;super.addEventListener(...args);}
  removeEventListener(...args){this.removed++;super.removeEventListener(...args);}
  requestVideoFrameCallback(callback){const id=++this.sequence;this.frames.set(id,callback);return id;}
  cancelVideoFrameCallback(id){this.frames.delete(id);}
  frame(time){this.currentTime=time;const frames=[...this.frames.values()];this.frames.clear();for(const callback of frames)callback();}
}
test("video consumers share one frame loop, deduplicate media events and clean up", () => {
  global.window = {setTimeout,clearTimeout};
  const {subscribeToVideoTime} = load("src/features/subtitles/shared/video-runtime.ts");
  const video = new FrameVideo(); let first=0, second=0;
  const stopFirst=subscribeToVideoTime(video,()=>first++);
  const stopSecond=subscribeToVideoTime(video,()=>second++);
  assert.equal(video.frames.size,1); assert.equal(video.added,8);
  video.frame(1); assert.equal(first,2); assert.equal(second,2);
  video.dispatchEvent(new Event("timeupdate")); assert.equal(first,2);
  stopFirst(); video.frame(2); assert.equal(first,2); assert.equal(second,3);
  video.paused=true; video.dispatchEvent(new Event("pause")); assert.equal(video.frames.size,0);
  video.currentTime=20;video.dispatchEvent(new Event("seeked"));assert.equal(second,5);
  stopSecond();assert.equal(video.removed,8);
  const stopNew=subscribeToVideoTime(video,()=>{});stopSecond();assert.equal(video.removed,8);stopNew();assert.equal(video.removed,16);
});

test("fallback video timer stays idle while paused and stops at the last unsubscribe", () => {
  const timers = new Map(); let id=0;
  global.window={setTimeout(callback){timers.set(++id,callback);return id;},clearTimeout(key){timers.delete(key);}};
  const {subscribeToVideoTime}=load("src/features/subtitles/shared/video-runtime.ts");
  const video=new FrameVideo();video.requestVideoFrameCallback=undefined;video.paused=true;
  const stop=subscribeToVideoTime(video,()=>{});assert.equal(timers.size,0);
  video.paused=false;video.dispatchEvent(new Event("play"));video.dispatchEvent(new Event("playing"));assert.equal(timers.size,1);
  stop();assert.equal(timers.size,0);
});

test("reading queue limits concurrency, shares subscribers, prioritizes playback and drops abandoned rows", async () => {
  const sent=[];const releases=[];
  global.chrome={runtime:{sendMessage:message=>new Promise(resolve=>{sent.push(message.payload.text);releases.push(()=>resolve({type:"ANALYZE_RESULT",payload:{tokens:[{surface:message.payload.text}]}}));})}};
  const {requestTranscriptReadings}=loader()("src/features/subtitles/shared/transcript-readings.ts");
  const first=requestTranscriptReadings("first","vi"), second=requestTranscriptReadings("second","vi");await flush();assert.deepEqual(sent,["first","second"]);
  const controller=new AbortController();
  const stale=requestTranscriptReadings("stale","vi",{signal:controller.signal}).catch(error=>error);
  const low=requestTranscriptReadings("row","vi");
  const high=requestTranscriptReadings("playback","vi",{priority:1});
  const same=requestTranscriptReadings("playback","vi");
  controller.abort();await stale;
  releases[0]();await first;await flush();assert.deepEqual(sent,["first","second","playback"]);
  releases[1]();await second;await flush();assert.equal(sent[3],"row");
  releases[2]();releases[3]();await Promise.all([low,high,same]);
  await requestTranscriptReadings("playback","vi");assert.equal(sent.length,4);
});

test("reading cancellation detaches one consumer without cancelling another and failures can retry", async () => {
  let calls=0,release;
  global.chrome={runtime:{sendMessage:message=>{calls++;return new Promise(resolve=>{release=()=>resolve({type:"ANALYZE_RESULT",payload:{tokens:[{surface:message.payload.text}]}});});}}};
  const {requestTranscriptReadings}=loader()("src/features/subtitles/shared/transcript-readings.ts");
  const controller=new AbortController();
  const cancelled=requestTranscriptReadings("school","en",{signal:controller.signal}).catch(()=>null);
  const live=requestTranscriptReadings("school","en");await flush();controller.abort();release();await Promise.all([cancelled,live]);assert.equal(calls,1);
  global.chrome.runtime.sendMessage=async()=>({type:"ERROR"});
  await assert.rejects(requestTranscriptReadings("retry","en"),/Incomplete/);
  global.chrome.runtime.sendMessage=async()=>({type:"ANALYZE_RESULT",payload:{tokens:[{surface:"retry"}]}});
  await requestTranscriptReadings("retry","en");
});

test("rapid transcript scrolling bounds queued work and cancellation discards unseen rows", async () => {
  const sent=[],releases=[];
  global.chrome={runtime:{sendMessage:message=>new Promise(resolve=>{sent.push(message.payload.text);releases.push(()=>resolve({type:"ANALYZE_RESULT",payload:{tokens:[{surface:message.payload.text}]}}));})}};
  const {requestTranscriptReadings}=loader()("src/features/subtitles/shared/transcript-readings.ts");
  const controllers=Array.from({length:200},()=>new AbortController());
  const requests=controllers.map((controller,index)=>requestTranscriptReadings(`row ${index}`,"vi",{signal:controller.signal}).catch(()=>null));
  await flush();assert.equal(sent.length,2);assert.equal(sent[0],"row 136");
  for(const controller of controllers)controller.abort();
  for(const release of releases)release();await Promise.all(requests);await flush();assert.equal(sent.length,2);
});

test("background shares duplicate subtitle analysis across contexts and isolates languages", async () => {
  let language="vi",calls=0,release;
  const {analyzeSubtitleReadings}=loader({
    "~/features/settings/settings-storage":{getSettings:async()=>({targetLanguage:language})},
    "~/features/dictionary/background-analysis":{analyzeLocal:async(text,definitions)=>{calls++;assert.equal(definitions,false);await new Promise(resolve=>release=resolve);return {text,tokens:[]};}},
  })("src/features/subtitles/shared/subtitle-analysis.ts");
  const first=analyzeSubtitleReadings("学校"), second=analyzeSubtitleReadings("学校");await flush();assert.equal(calls,1);release();await Promise.all([first,second]);
  await analyzeSubtitleReadings("学校");assert.equal(calls,1);
  language="en";const english=analyzeSubtitleReadings("学校");await flush();assert.equal(calls,2);release();await english;
});

test("readings-only kana analysis makes no remote dictionary requests and deduplicates kanji lookups", async () => {
  let remote=0,local=0;
  const {analyzeLocal}=loader({
    "~/features/settings/settings-storage":{getSettings:async()=>({targetLanguage:"vi"})},
    "~/features/dictionary/local-lookup":{searchDictionary:async()=>{local++;return [];}},
    "~/features/dictionary/dictionary-lookup":{lookupWord:async()=>{remote++;return {reading:"がっこう",meaning:"school"};}},
    "~/features/dictionary/google-translate":{googleTranslateService:{}},
  })("src/features/dictionary/background-analysis.ts");
  const kana=await analyzeLocal("かな カナ",false);assert.equal(remote,0);assert.equal(local,0);assert.equal(kana.tokens.map(t=>t.surface).join(""),"かな カナ");
  await analyzeLocal("学校 学校 学校",false);assert.equal(remote,1);assert.equal(local,1);
});

test("automatic reading failures do not start full LLM analysis; explicit analysis still works", async () => {
  let fullAnalysis=0;
  const {handleDictionaryMessage}=loader({
    "~/features/settings/settings-storage":{getSettings:async()=>({})},
    "~/features/dictionary/api-client":{apiClient:{analyzePhrase:async request=>{fullAnalysis++;return {text:request.text,tokens:[]};}}},
    "~/features/subtitles/shared/subtitle-analysis":{analyzeSubtitleReadings:async()=>{throw new Error("readings unavailable");}},
    "./background-analysis":{},"./background-translation":{},
  })("src/features/dictionary/messages.ts");
  assert.equal((await handleDictionaryMessage({type:"ANALYZE_TEXT",payload:{text:"学校",include_definitions:false}})).type,"ERROR");
  assert.equal(fullAnalysis,0);
  assert.equal((await handleDictionaryMessage({type:"ANALYZE_TEXT",payload:{text:"学校"}})).type,"ANALYZE_RESULT");
  assert.equal(fullAnalysis,1);
});
