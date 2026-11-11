import { ankiClient } from "./anki-connect";
import { ankiStorage } from "./sync-storage";

export function mediaNames(value: string): string[] {
  return [...new Set([
    ...Array.from(value.matchAll(/\[sound:([^\]\r\n]+)\]/g), match => match[1]),
    ...Array.from(value.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi), match => match[1] || match[2] || match[3]),
  ])].filter(name => !/^(?:[a-z]+:|\/\/)/i.test(name));
}

function mimeFor(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", webm: "audio/webm",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
  const mime = types[extension || ""];
  if (!mime) throw new Error("Unsupported media format.");
  return mime;
}

export async function loadMedia(profile: string, filename: string): Promise<string> {
  const key = `${profile}:${filename}`;
  let record = await ankiStorage.media(key);
  if (!record) {
    if (await ankiClient.getProfile() !== profile) throw new Error("Anki profile changed.");
    const data = await ankiClient.retrieveMedia(filename);
    if (!data) throw new Error(`Missing Anki media: ${filename}`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("Invalid media encoding.");
    record = { key, profile, filename, data, mime: mimeFor(filename) };
    await ankiStorage.putMedia(record);
  }
  return `data:${record.mime};base64,${record.data}`;
}

export async function uploadLocalMedia(file: File, expectedProfile?: string): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const filename = `hakkutsu_${crypto.randomUUID()}.${extension}`;
  const mime = mimeFor(filename);
  const profile = await ankiClient.getProfile();
  if (expectedProfile && expectedProfile !== profile) throw new Error("Anki profile changed. Reopen this entry in the correct profile.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
  const data = btoa(binary);
  if (await ankiClient.getProfile() !== profile) throw new Error("Anki profile changed during the upload.");
  const storedName = await ankiClient.storeMedia(filename, data);
  await ankiStorage.putMedia({ key: `${profile}:${storedName}`, profile, filename: storedName, data, mime });
  return mime.startsWith("audio/") ? `[sound:${storedName}]` : `<img src="${storedName}">`;
}
