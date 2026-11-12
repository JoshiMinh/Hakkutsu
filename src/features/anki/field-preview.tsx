import { AudioButton } from "./audio-button";
import { soundNames } from "./audio-player";
import { useEffect, useMemo, useState } from "react";
import { mediaNames, loadMedia } from "./media";
import { useTranslation } from "~/shared/locales";

/** Imported HTML is reference data: render only semantic tags, never style/script/URL attributes. */
export function sanitizeAnkiHtml(value: string): string {
  const template = document.createElement("template");
  template.innerHTML = value.replace(/\[sound:[^\]]+\]/g, "");
  const parsed = template.content; // Template content cannot load images or frames during parsing.
  const allowed = new Set(["B", "STRONG", "I", "EM", "U", "BR", "RUBY", "RT", "RP", "UL", "OL", "LI", "SPAN"]);
  for (const element of Array.from(parsed.querySelectorAll("script,style,iframe,object,embed,svg,math,template"))) element.remove();
  for (const element of Array.from(parsed.querySelectorAll("*")).reverse()) {
    if (!allowed.has(element.tagName)) element.replaceWith(...Array.from(element.childNodes));
    else for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  }
  return template.innerHTML;
}

export function FieldPreview({ value, profile, autoPlay = false, playbackKey }: { value: string; profile?: string; autoPlay?: boolean; playbackKey?: string }) {
  const html = useMemo(() => sanitizeAnkiHtml(value), [value]);
  return <div className="hk-anki-field">
    <span dangerouslySetInnerHTML={{ __html: html }} />
    {soundNames(value).length > 0 && <AudioButton field={value} profile={profile} autoPlay={autoPlay} playbackKey={playbackKey} showLabel />}
    {profile && mediaNames(value).filter(filename => !soundNames(value).includes(filename)).map(filename => <AnkiMedia key={`${profile}:${filename}`} profile={profile} filename={filename} />)}
  </div>;
}

export function AnkiMedia({ profile, filename, autoPlay = false }: { profile: string; filename: string; autoPlay?: boolean }) {
  const { t } = useTranslation();
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSource(""); setError("");
    loadMedia(profile, filename).then(value => { if (active) setSource(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [profile, filename]);
  if (error) return <span role="status">{t("anki_missing_media")}: {filename}</span>;
  if (!source) return <span role="status">{t("anki_loading_media")}</span>;
  return source.startsWith("data:audio/") ? <audio controls autoPlay={autoPlay} preload="metadata" src={source} aria-label={t("anki_field_word_audio")} />
    : <img src={source} alt={filename} loading="lazy" />;
}
