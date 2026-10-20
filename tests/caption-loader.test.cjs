const {test} = require("node:test");
const assert = require("node:assert/strict");
const {loader} = require("./load-typescript.cjs");
const captions = JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:"学校"}]}]});
const flush = () => new Promise(resolve => setImmediate(resolve));

async function clocked(run) {
  const nativeTimeout=global.setTimeout, nativeClear=global.clearTimeout;
  let now=0,id=0;const timers=new Map();
  global.setTimeout=(callback,delay)=>{const key=++id;timers.set(key,{callback,time:now+delay});return key;};
  global.clearTimeout=key=>timers.delete(key);
  global.window={location:{href:"https://www.youtube.com/watch?v=test"}};
  global.document=new EventTarget();
  const advance=async target=>{
    await flush();
    for(;;){const next=[...timers].filter(([,timer])=>timer.time<=target).sort((a,b)=>a[1].time-b[1].time)[0];if(!next)break;now=next[1].time;timers.delete(next[0]);next[1].callback();await flush();}
    now=target;
  };
  try {await run({advance,timers});} finally {global.setTimeout=nativeTimeout;global.clearTimeout=nativeClear;}
}
const track={url:"https://www.youtube.com/api/timedtext?v=test",name:"Japanese"};

test("fast caption downloads do not launch fallback transports",async()=>clocked(async({advance,timers})=>{
  let fallback=0;
  global.fetch=async()=>({ok:true,text:async()=>captions});
  global.chrome={runtime:{sendMessage:async()=>{fallback++;throw new Error("unexpected");}}};
  document.addEventListener("hakkutsu:request-youtube-caption-content",()=>fallback++);
  const {loadYouTubeCaptionTrack}=loader()("src/features/subtitles/youtube/youtube-caption-loader.ts");
  const result=await loadYouTubeCaptionTrack(track);
  assert.equal(result[0].text,"学校");await advance(1000);assert.equal(fallback,0);assert.equal(timers.size,0);
}));

test("a stalled direct fetch uses page captions after 200ms and cancels the loser",async()=>clocked(async({advance,timers})=>{
  let aborted=0,background=0;
  global.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>{aborted++;reject(new Error("cancelled"));}));
  global.chrome={runtime:{sendMessage:async()=>{background++;return {};}}};
  document.addEventListener("hakkutsu:request-youtube-caption-content",event=>document.dispatchEvent(new CustomEvent("hakkutsu:youtube-caption-content",{detail:{requestId:event.detail.requestId,text:captions}})));
  const {loadYouTubeCaptionTrack}=loader()("src/features/subtitles/youtube/youtube-caption-loader.ts");
  let finished=false;const request=loadYouTubeCaptionTrack(track).then(result=>{finished=true;return result;});
  await advance(199);assert.equal(finished,false);await advance(200);assert.equal((await request)[0].text,"学校");
  assert.equal(aborted,1);assert.equal(background,0);assert.equal(timers.size,0);
}));

test("empty/error transports advance immediately and preserve background fallback",async()=>clocked(async({timers})=>{
  global.fetch=async()=>({ok:false,status:403});
  global.chrome={runtime:{sendMessage:async()=>({payload:{success:true,text:captions}})}};
  document.addEventListener("hakkutsu:request-youtube-caption-content",event=>document.dispatchEvent(new CustomEvent("hakkutsu:youtube-caption-content",{detail:{requestId:event.detail.requestId,text:""}})));
  const {loadYouTubeCaptionTrack}=loader()("src/features/subtitles/youtube/youtube-caption-loader.ts");
  assert.equal((await loadYouTubeCaptionTrack(track))[0].start,1);assert.equal(timers.size,0);
}));

test("track cancellation stops direct/page requests and clears delayed fallback work",async()=>clocked(async({advance,timers})=>{
  let cancelled=0;
  global.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("cancelled"))));
  global.chrome={runtime:{sendMessage:async()=>{throw new Error("should not start");}}};
  document.addEventListener("hakkutsu:cancel-youtube-caption-content",()=>cancelled++);
  const {loadYouTubeCaptionTrack}=loader()("src/features/subtitles/youtube/youtube-caption-loader.ts");
  const controller=new AbortController();
  const request=loadYouTubeCaptionTrack(track,controller.signal);
  const rejected=assert.rejects(request,error=>error.name==="AbortError");
  await advance(200);controller.abort();await rejected;assert.equal(cancelled,1);assert.equal(timers.size,0);
}));

test("original-format failures still retry JSON3 and clean up every attempt",async()=>clocked(async({timers})=>{
  const urls=[];
  global.fetch=async url=>{urls.push(url);return url.includes("fmt=json3")?{ok:true,text:async()=>captions}:{ok:false,status:403};};
  global.chrome={runtime:{sendMessage:async()=>({payload:{success:false,error:"blocked"}})}};
  document.addEventListener("hakkutsu:request-youtube-caption-content",event=>document.dispatchEvent(new CustomEvent("hakkutsu:youtube-caption-content",{detail:{requestId:event.detail.requestId,error:"blocked"}})));
  const {loadYouTubeCaptionTrack}=loader()("src/features/subtitles/youtube/youtube-caption-loader.ts");
  assert.equal((await loadYouTubeCaptionTrack(track))[0].text,"学校");assert.equal(urls.length,2);assert.equal(timers.size,0);
}));
