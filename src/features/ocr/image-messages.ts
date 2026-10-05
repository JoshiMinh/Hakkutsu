import type { ExtensionMessage } from "~/shared/browser/messages";

export async function handleOcrImage(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  const { url } = (message.payload || {}) as {
    query?: string;
    targetLang?: string;
    meaning?: string;
    url?: string;
  };
  if (url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Image request failed (${res.status})`);
      const blob = await res.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      const dataUrl = `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
      return { type: "FETCH_IMAGE_RESULT", payload: { dataUrl } };
    } catch (err: any) {
      throw new Error(`Failed to fetch image: ${err.message || err}`);
    }
  }
  return { type: "FETCH_IMAGE_RESULT", payload: { images: [] } };
}
