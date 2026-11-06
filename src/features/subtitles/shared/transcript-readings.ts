import type { TokenAnalysis } from "~/features/dictionary/types";
import { createSubtitleRequests } from "./subtitle-requests";

const readings = createSubtitleRequests<TokenAnalysis[]>(async text => {
  const response = await chrome.runtime.sendMessage({ type: "ANALYZE_TEXT", payload: { text, include_definitions: false } });
  const tokens: TokenAnalysis[] = response?.payload?.tokens;
  if (response?.type !== "ANALYZE_RESULT" || !Array.isArray(tokens) || tokens.some(token => typeof token?.surface !== "string") ||
    tokens.map(token => token.surface).join("").replace(/\s/g, "") !== text.replace(/\s/g, "")) throw new Error("Incomplete subtitle readings");
  return tokens;
});

export const requestTranscriptReadings = readings.request;
export const peekTranscriptReadings = readings.peek;
