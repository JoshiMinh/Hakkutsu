import { useState, useRef, useEffect, useCallback } from "react";
import type { ExtensionSettings } from "~/features/settings/types";
import { ankiClient } from "~/features/anki/anki-connect";
import { inferAnkiFieldMapping } from "~/features/anki/anki-fields";

export function useAnkiSettings(
  settings: ExtensionSettings,
  onUpdate: (patch: Partial<ExtensionSettings>) => void,
) {
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [ankiConnected, setAnkiConnected] = useState<boolean>(false);
  const [loadingAnki, setLoadingAnki] = useState<boolean>(false);
  const modelRequest = useRef(0);
  const refreshRequest = useRef(0);

  const fetchAnkiData = useCallback(
    async (selectedModel?: string) => {
      const request = ++refreshRequest.current;
      setLoadingAnki(true);
      try {
        const connected = await ankiClient.isConnected();
        if (request !== refreshRequest.current) return;
        setAnkiConnected(connected);
        if (connected) {
          const [dList, mList] = await Promise.all([
            ankiClient.getDecks().catch(() => [] as string[]),
            ankiClient.getModels().catch(() => [] as string[]),
          ]);
          if (request !== refreshRequest.current) return;
          setDecks(dList);
          setModels(mList);

          const currentModel =
            selectedModel ||
            settings.ankiModel ||
            (mList.length > 0 ? mList[0] : "");
          if (currentModel) {
            const fList = await ankiClient
              .getModelFields(currentModel)
              .catch(() => [] as string[]);
            if (request !== refreshRequest.current) return;
            setFields(fList);
          } else {
            setFields([]);
          }
        } else {
          setDecks([]);
          setModels([]);
          setFields([]);
        }
      } catch (e) {
        console.error("Anki data load error:", e);
        if (request === refreshRequest.current) setAnkiConnected(false);
      } finally {
        if (request === refreshRequest.current) setLoadingAnki(false);
      }
    },
    [settings.ankiModel],
  );

  useEffect(() => {
    if (settings.ankiEnabled !== false) void fetchAnkiData();
    else {
      ++modelRequest.current;
      ++refreshRequest.current;
      setAnkiConnected(false);
      setDecks([]);
      setModels([]);
      setFields([]);
      setLoadingAnki(false);
    }
  }, [settings.ankiEnabled, fetchAnkiData]);

  const inferDefaultMapping = inferAnkiFieldMapping;

  const handleModelChange = async (newModel: string) => {
    const request = ++modelRequest.current;
    ++refreshRequest.current;
    onUpdate({ ankiModel: newModel });
    setLoadingAnki(true);
    try {
      const fList = await ankiClient
        .getModelFields(newModel)
        .catch(() => [] as string[]);
      if (request !== modelRequest.current) return;
      setFields(fList);

      const existingMap: Record<string, string> = {};
      for (const f of fList) {
        existingMap[f] = settings.ankiFieldMap?.[f] || inferDefaultMapping(f);
      }
      onUpdate({ ankiModel: newModel, ankiFieldMap: existingMap });
    } catch {
      setFields([]);
    } finally {
      if (request === modelRequest.current) setLoadingAnki(false);
    }
  };

  return {
    decks,
    models,
    fields,
    ankiConnected,
    loadingAnki,
    fetchAnkiData,
    handleModelChange,
    inferDefaultMapping,
  };
}
