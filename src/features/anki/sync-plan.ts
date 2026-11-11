import type { SrsCard } from "~/features/srs/local-srs";
import type { RemoteNote } from "./sync-types";
import { japaneseFieldNames, localValues, fieldsForCard, plainText, type JapaneseField, type JapaneseValues } from "./japanese-schema";

export interface FieldConflict { field: JapaneseField; local: string; anki: string }
export interface SyncRow {
  id: string;
  kind: "import" | "link" | "update" | "export" | "missing" | "hidden" | "ambiguous" | "unchanged";
  local?: SrsCard;
  remote?: RemoteNote;
  candidates?: SrsCard[];
  fields: JapaneseValues;
  conflicts: FieldConflict[];
  selected: boolean;
  choices: Partial<Record<JapaneseField, "local" | "anki">>;
}
export interface SyncPlan {
  profile: string;
  deck: string;
  deckId: number;
  model: string;
  rows: SyncRow[];
}

export function noteFields(note: RemoteNote): JapaneseValues {
  if (japaneseFieldNames.some(field => typeof note.fields[field]?.value !== "string")) {
    throw new Error(`Note ${note.noteId} does not match the Japanese preset.`);
  }
  return Object.fromEntries(japaneseFieldNames.map(field => [field, note.fields[field].value])) as JapaneseValues;
}

export function mergeFields(local: SrsCard, remote: RemoteNote, firstLink = false) {
  const mine = fieldsForCard(local), theirs = noteFields(remote);
  const fields = { ...theirs }, conflicts: FieldConflict[] = [];
  for (const field of japaneseFieldNames) {
    if (mine[field] === theirs[field]) continue;
    const base = local.anki?.baseline[field];
    if (firstLink || base === undefined || (mine[field] !== base && theirs[field] !== base)) {
      conflicts.push({ field, local: mine[field], anki: theirs[field] });
    } else if (theirs[field] === base) fields[field] = mine[field];
  }
  return { fields, conflicts };
}

const matchKey = (word: string, reading: string) => `${plainText(word).trim().toLowerCase()}\u0000${plainText(reading).trim()}`;

/** Pure three-way diff: building a preview never writes to either app. */
export function buildSyncPlan(context: Omit<SyncPlan, "rows">, locals: SrsCard[], notes: RemoteNote[], hidden: Set<number>): SyncPlan {
  const rows: SyncRow[] = [];
  const used = new Set<string>();
  const remoteKeys = new Map<string, number>();
  const links = new Map<number, SrsCard[]>(), unlinked = new Map<string, SrsCard[]>();
  for (const card of locals) {
    if (card.anki?.profile === context.profile) {
      const matches = links.get(card.anki.noteId) || []; matches.push(card); links.set(card.anki.noteId, matches);
    } else if (!card.anki) {
      const key = matchKey(card.word, card.reading || ""), matches = unlinked.get(key) || [];
      matches.push(card); unlinked.set(key, matches);
    }
  }
  for (const note of notes) {
    const f = noteFields(note), key = matchKey(f.Word, f["Word Reading"]);
    remoteKeys.set(key, (remoteKeys.get(key) || 0) + 1);
  }
  for (const remote of notes) {
    const fields = noteFields(remote);
    const key = matchKey(fields.Word, fields["Word Reading"]);
    const linked = links.get(remote.noteId) || [];
    if (linked.length > 1) throw new Error(`Multiple local links point to Anki note ${remote.noteId}. Restore or unlink the duplicate first.`);
    const candidates = linked.length ? linked : unlinked.get(key) || [];
    for (const candidate of candidates) used.add(candidate.id);
    let kind: SyncRow["kind"] = hidden.has(remote.noteId) && !linked.length ? "hidden" : "import";
    let local = linked[0];
    if (kind !== "hidden") {
      if (!local && (candidates.length > 1 || (candidates.length > 0 && remoteKeys.get(key)! > 1))) kind = "ambiguous";
      else if (!local && candidates.length === 1) { local = candidates[0]; kind = "link"; }
      else if (local) kind = "update";
    }
    const merged = local ? mergeFields(local, remote, kind === "link") : { fields, conflicts: [] };
    if (kind === "update" && !merged.conflicts.length && local?.anki?.verified && !local.anki.missing &&
      japaneseFieldNames.every(field => merged.fields[field] === fields[field] && fields[field] === local!.anki!.baseline[field]) &&
      JSON.stringify(local.tags || []) === JSON.stringify(remote.tags)) kind = "unchanged";
    rows.push({ id: `note:${remote.noteId}`, kind, local, remote, candidates, ...merged,
      selected: !["hidden", "ambiguous", "unchanged"].includes(kind), choices: {} });
  }
  const remoteIds = new Set(notes.map(note => note.noteId));
  for (const local of locals) {
    if (used.has(local.id)) continue;
    if (local.anki) {
      if (local.anki.profile === context.profile && local.anki.deckId === context.deckId && !remoteIds.has(local.anki.noteId)) {
        rows.push({ id: `local:${local.id}`, kind: "missing", local, fields: fieldsForCard(local), conflicts: [], choices: {}, selected: true });
      }
    } else rows.push({ id: `local:${local.id}`, kind: "export", local, fields: fieldsForCard(local), conflicts: [], choices: {}, selected: true });
  }
  return { ...context, rows };
}

export function resolveRow(row: SyncRow): JapaneseValues {
  const fields = { ...row.fields };
  for (const conflict of row.conflicts) {
    const choice = row.choices[conflict.field];
    if (!choice) throw new Error(`Choose a value for ${conflict.field}.`);
    fields[conflict.field] = choice === "local" ? conflict.local : conflict.anki;
  }
  if (!plainText(fields.Word).trim()) throw new Error("Word cannot be empty.");
  return fields;
}

export function chooseLink(row: SyncRow, local?: SrsCard): SyncRow {
  if (!row.remote) return row;
  return { ...row, local, kind: local ? "link" : "import", selected: true, choices: {},
    ...(local ? mergeFields(local, row.remote, true) : { fields: noteFields(row.remote), conflicts: [] }) };
}

export function localUnchanged(current: SrsCard, expected: SrsCard): boolean {
  return current.updated_at === expected.updated_at && JSON.stringify(localValues(current)) === JSON.stringify(localValues(expected)) &&
    JSON.stringify(current.tags) === JSON.stringify(expected.tags) && JSON.stringify(current.anki) === JSON.stringify(expected.anki);
}
