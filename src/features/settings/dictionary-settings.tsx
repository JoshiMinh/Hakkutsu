import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, CircleAlert, HardDrive, Loader2, Upload } from "lucide-react";
import { getDB } from "~/features/dictionary/local-lookup";
import { importDictionary } from "~/features/dictionary/dictionary-sync";
import "./dictionary-settings.css";

export function DictionarySettings({ language }: { language: string }) {
  const vi = language === "vi";
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importedFile, setImportedFile] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(0);
  useEffect(() => {
    const id = ++revision.current;
    void getDB().then(db => db.count("jmdict")).then(value => { if (id === revision.current) setCount(value); })
      .catch(() => { if (id === revision.current) setError(vi ? "Không thể mở từ điển. Hãy thử nhập lại tệp." : "Could not open the dictionary. Try importing the file again."); });
    return () => { revision.current++; };
  }, [vi]);
  const state = busy ? "loading" : error ? "error" : importedFile ? "success" : "default";
  const status = busy ? (vi ? "Đang nhập từ điển…" : "Importing dictionary…")
    : count === null ? (vi ? "Đang kiểm tra…" : "Checking dictionary…")
    : vi ? `${count.toLocaleString("vi-VN")} mục từ đã cài đặt` : `${count.toLocaleString("en-US")} entries installed`;
  return <section className="hk-settings-card hk-dictionary-settings" data-state={state} aria-labelledby="dictionary-title" aria-busy={busy}>
    <header className="hk-settings-card__header">
      <div className="hk-settings-card__icon"><BookOpen size={18} aria-hidden="true" /></div>
      <h3 id="dictionary-title" className="hk-settings-card__title">{vi ? "Từ điển ngoại tuyến" : "Offline dictionary"}</h3>
      <span className="hk-dictionary-settings__local"><HardDrive size={12} aria-hidden="true" />{vi ? "Trên thiết bị" : "On device"}</span>
    </header>
    <div className="hk-settings-card__body">
      <div className="hk-settings-row hk-dictionary-settings__row">
        <div className="hk-settings-row__info">
          <p className="hk-settings-row__label" role="status">{status}</p>
          <p className="hk-settings-row__desc" id="dictionary-import-help">{vi ? "Thêm từ điển để hiển thị furigana khi đọc trang web." : "Add a dictionary to show furigana while reading webpages."}</p>
        </div>
        <span className="hk-dictionary-settings__badge">{count ? (vi ? "Sẵn sàng" : "Ready") : (vi ? "Chưa cài đặt" : "Not installed")}</span>
      </div>
      <div className="hk-settings-row hk-dictionary-settings__row">
        <div className="hk-settings-row__info">
          <label className="hk-settings-row__label" htmlFor="dictionary-import">{vi ? "Dữ liệu từ điển" : "Dictionary data"}</label>
          <p className="hk-settings-row__desc">{vi ? "JMdict JSON · định dạng Hakkutsu. Các mục từ khác được giữ lại." : "JMdict JSON · Hakkutsu format. Other entries are kept."}</p>
        </div>
        <button type="button" className="hk-btn hk-btn--secondary hk-dictionary-settings__import" disabled={busy} onClick={() => fileInput.current?.click()} aria-describedby="dictionary-import-help dictionary-import-feedback">
          {busy ? <Loader2 size={16} className="hk-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {busy ? (vi ? "Đang nhập…" : "Importing…") : (vi ? "Chọn tệp JSON" : "Choose JSON file")}
        </button>
      </div>
      <input ref={fileInput} className="hk-sr-only" tabIndex={-1} id="dictionary-import" type="file" accept=".json,application/json" disabled={busy} aria-invalid={!!error} aria-describedby="dictionary-import-help dictionary-import-feedback" onChange={async event => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        const id = ++revision.current;
        setBusy(true); setError(""); setImportedFile("");
        try {
          const value = await importDictionary(JSON.parse(await file.text()));
          if (id === revision.current) { setCount(value); setImportedFile(file.name); }
        } catch (error) {
          if (id === revision.current) setError(error instanceof Error ? error.message : String(error));
        } finally { if (id === revision.current) setBusy(false); input.value = ""; }
      }} />
      <div className="hk-dictionary-settings__feedback" id="dictionary-import-feedback">
        {error ? <p role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p>
          : importedFile ? <p role="status"><Check size={15} aria-hidden="true" />{vi ? "Đã nhập" : "Imported"} <span>{importedFile}</span></p>
          : <p><HardDrive size={14} aria-hidden="true" />{vi ? "Từ điển được lưu cục bộ, không cần kết nối khi tra cứu." : "Stored locally. No connection needed for dictionary lookups."}</p>}
      </div>
    </div>
  </section>;
}
