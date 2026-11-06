import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { SubtitleFetchResult, SubtitleSegment } from "./types";
import type { TokenAnalysis } from "~/features/dictionary/types";
import { cleanSubtitleText } from "./subtitle-parsers";
import { createSubtitlePreparation } from "./subtitle-preparation";
import { pairSubtitleTracks } from "./subtitle-pairs";
import { peekTranscriptReadings } from "./transcript-readings";
import { peekSubtitleTranslation } from "./subtitle-translations";
import { subscribeToVideoTime } from "./video-runtime";

const EMPTY_CUES: SubtitleSegment[] = [];

export function useSubtitlePreparation(options: {
  enabled: boolean; track: SubtitleFetchResult | null; secondary?: SubtitleFetchResult | null;
  cue: SubtitleSegment | null; secondaryCue?: SubtitleSegment | null; secondaryTrackId?: string;
  language: string; readings: boolean; bilingual: boolean; offset: number;
  videoRef: RefObject<HTMLVideoElement>;
}) {
  const { enabled, track, secondary, cue, secondaryCue, secondaryTrackId, language, readings, bilingual, videoRef, offset } = options;
  const preparation = useMemo(() => createSubtitlePreparation(track?.segments || EMPTY_CUES, language), [track, language]);
  const pairs = useMemo(() => pairSubtitleTracks(track?.segments || EMPTY_CUES, secondary?.segments || EMPTY_CUES), [track, secondary]);
  const automatic = bilingual && secondaryTrackId === "__auto_translate__";
  const native = bilingual && Boolean(secondaryTrackId) && !automatic;
  const text = cleanSubtitleText(cue?.text || "");
  const video = videoRef.current;
  const [analysis, setAnalysis] = useState<{ identity: object; text: string; tokens: TokenAnalysis[] }>();
  const [translation, setTranslation] = useState<{ identity: object; text: string; value: string; failed: boolean }>();

  useEffect(() => {
    if (!enabled) return;
    preparation.setPosition((video?.currentTime || 0) - offset);
    preparation.start({ readings, translations: automatic });
    const unbind = video ? subscribeToVideoTime(video, () => preparation.setPosition(video.currentTime - offset)) : undefined;
    return () => { unbind?.(); preparation.stop(); };
  }, [preparation, enabled, readings, automatic, video, offset]);

  useEffect(() => {
    if (cue) preparation.setPosition(cue.start);
  }, [preparation, cue?.start]);

  useEffect(() => {
    if (!enabled || !readings || !text) return;
    const controller = new AbortController();
    void preparation.getReadings(text, { signal: controller.signal, priority: 1 }).then(tokens => {
      if (!controller.signal.aborted) setAnalysis({ identity: preparation.identity, text, tokens });
    }).catch(() => {});
    return () => controller.abort();
  }, [preparation, enabled, readings, text]);

  useEffect(() => {
    if (!enabled || !automatic || !text) return;
    const controller = new AbortController();
    void preparation.getTranslation(text, { signal: controller.signal, priority: 1 }).then(value => {
      if (!controller.signal.aborted) setTranslation({ identity: preparation.identity, text, value, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setTranslation({ identity: preparation.identity, text, value: "", failed: true });
    });
    return () => controller.abort();
  }, [preparation, enabled, automatic, text]);

  const matchingTranslation = translation?.identity === preparation.identity && translation.text === text ? translation : undefined;
  const translated = automatic ? preparation.peekTranslation(text) || peekSubtitleTranslation(text, language) || matchingTranslation?.value || "" : "";
  const failed = automatic && Boolean(matchingTranslation?.failed);
  const nativeText = useMemo(() => {
    if (!secondary || !cue) return cleanSubtitleText(secondaryCue?.text || "");
    return pairs.get(cue) ?? pairSubtitleTracks([cue], secondary.segments).get(cue) ?? "";
  }, [pairs, secondary, cue, secondaryCue]);
  const matchingTokens = analysis?.identity === preparation.identity && analysis.text === text ? analysis.tokens : undefined;
  return {
    tokens: readings ? preparation.peekReadings(text) || peekTranscriptReadings(text, language) || matchingTokens : undefined,
    secondaryText: bilingual ? (automatic ? translated : nativeText) : "",
    waitingForPair: Boolean(enabled && text && ((automatic && !translated && !failed) || (native && !secondary))),
    translationFailed: Boolean(enabled && text && failed),
  };
}
