import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "~/shared/locales";
const usFlag = "/assets/language/en.png";
const vnFlag = "/assets/language/vi.png";
const zhFlag = "/assets/language/zh.png";
const jaFlag = "/assets/language/ja.png";
const koFlag = "/assets/language/ko.png";
const esFlag = "/assets/language/es.png";
const frFlag = "/assets/language/fr.png";
const idFlag = "/assets/language/id.png";

const FLAG_MAP: Record<string, string> = {
  en: usFlag,
  vi: vnFlag,
  ja: jaFlag,
  zh: zhFlag,
  ko: koFlag,
  es: esFlag,
  fr: frFlag,
  id: idFlag,
};

export function CustomLanguageDropdown({
  value,
  onChange,
}: {
  value: SupportedLanguageCode;
  onChange: (code: SupportedLanguageCode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLangObj = SUPPORTED_LANGUAGES[value] || SUPPORTED_LANGUAGES.vi;

  return (
    <div ref={containerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "#18181c",
          border: "1.5px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "10px",
          padding: "8px 12px",
          color: "#fff",
          fontSize: "13px",
          fontWeight: 700,
          cursor: "pointer",
          outline: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          transition: "all 0.2s ease",
        }}
      >
        <img
          src={FLAG_MAP[value] || FLAG_MAP.vi}
          alt={value}
          style={{
            width: "20px",
            height: "20px",
            objectFit: "contain",
            borderRadius: "2px",
          }}
        />
        <span>{currentLangObj.nativeName}</span>
        <ChevronDown
          size={14}
          style={{
            color: "#a1a1aa",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 1000,
            minWidth: "160px",
            backgroundColor: "#18181c",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "12px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            padding: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            backdropFilter: "blur(12px)",
          }}
        >
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = lang.code === value;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onChange(lang.code as SupportedLanguageCode);
                  setIsOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: isSelected
                    ? "rgba(192, 132, 252, 0.12)"
                    : "transparent",
                  color: isSelected ? "#c084fc" : "#e4e4e7",
                  fontSize: "13px",
                  fontWeight: isSelected ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    e.currentTarget.style.backgroundColor =
                      "rgba(255, 255, 255, 0.08)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected)
                    e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px" }}
                >
                  <img
                    src={FLAG_MAP[lang.code] || FLAG_MAP.vi}
                    alt={lang.code}
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                      borderRadius: "2px",
                    }}
                  />
                  <span>{lang.nativeName}</span>
                </div>
                {isSelected && (
                  <Check
                    size={14}
                    style={{ color: "#c084fc", marginLeft: "8px" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface CustomSelectOption {
  value: string;
  label: string;
  group?: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  width = "260px",
}: {
  value: string;
  onChange: (val: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  width?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);
  const groups = Array.from(
    new Set(options.map((o) => o.group).filter(Boolean)),
  ) as string[];

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width, flexShrink: 0 }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          backgroundColor: "#18181c",
          border: "1.5px solid rgba(255, 255, 255, 0.14)",
          borderRadius: "10px",
          padding: "8px 12px",
          color: selectedOption ? "#ffffff" : "#a1a1aa",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          outline: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          transition: "all 0.2s ease",
          textAlign: "left",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginRight: "8px",
          }}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: "#a1a1aa",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 1000,
            width: "100%",
            minWidth: "260px",
            maxHeight: "320px",
            overflowY: "auto",
            backgroundColor: "#18181c",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "12px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            padding: "6px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            backdropFilter: "blur(14px)",
          }}
        >
          {groups.length > 0
            ? groups.map((groupName) => {
                const groupOptions = options.filter(
                  (o) => o.group === groupName,
                );
                return (
                  <div key={groupName} style={{ marginBottom: "6px" }}>
                    <div
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        color: "#c084fc",
                        letterSpacing: "0.6px",
                        padding: "6px 8px 3px",
                        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      {groupName}
                    </div>
                    {groupOptions.map((opt) => (
                      <OptionButton
                        key={opt.value}
                        opt={opt}
                        isSelected={opt.value === value}
                        onClick={() => {
                          onChange(opt.value);
                          setIsOpen(false);
                        }}
                      />
                    ))}
                  </div>
                );
              })
            : options.map((opt) => (
                <OptionButton
                  key={opt.value}
                  opt={opt}
                  isSelected={opt.value === value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                />
              ))}
        </div>
      )}
    </div>
  );
}

function OptionButton({
  opt,
  isSelected,
  onClick,
}: {
  opt: CustomSelectOption;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "7px 10px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: isSelected
          ? "rgba(192, 132, 252, 0.14)"
          : "transparent",
        color: isSelected ? "#c084fc" : "#e4e4e7",
        fontSize: "12.5px",
        fontWeight: isSelected ? 700 : 500,
        cursor: "pointer",
        textAlign: "left",
        transition: "background-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!isSelected)
          e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {opt.label}
      </span>
      {isSelected && (
        <Check
          size={14}
          style={{ color: "#c084fc", marginLeft: "8px", flexShrink: 0 }}
        />
      )}
    </button>
  );
}

export function FeatureSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="hk-toggle hk-feature-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="hk-toggle__slider" />
    </label>
  );
}

export function CompactToggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="hk-settings-row">
      <div className="hk-settings-row__info">
        <label className="hk-settings-row__label" htmlFor={id}>
          {label}
        </label>
        <div id={`${id}-desc`} className="hk-settings-row__desc">
          {description}
        </div>
      </div>
      <div className="hk-settings-row__control">
        <label className="hk-toggle" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            aria-describedby={`${id}-desc`}
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="hk-toggle__slider" />
        </label>
      </div>
    </div>
  );
}
