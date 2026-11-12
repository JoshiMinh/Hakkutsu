import { useState, useRef, useEffect, useId } from "react";
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

export function CustomSelect({ value, onChange, options, placeholder = "Select...", width = "260px", id, ariaLabel, describedBy, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  width?: string;
  id?: string;
  ariaLabel?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  const uid = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.findIndex(option => option.value === value);
  const close = () => { setIsOpen(false); trigger.current?.focus(); };
  const choose = (index: number) => { if (options[index]) onChange(options[index].value); close(); };
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setIsOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);
  useEffect(() => { if (isOpen) container.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, isOpen]);
  useEffect(() => { if (disabled) setIsOpen(false); }, [disabled]);
  return <div ref={container} className="hk-custom-select" style={{ width }}>
    <button ref={trigger} id={id} type="button" className="hk-custom-select__trigger" role="combobox" aria-label={ariaLabel || placeholder}
      aria-describedby={describedBy} aria-controls={`${uid}-list`} aria-expanded={isOpen} aria-haspopup="listbox" disabled={disabled}
      aria-activedescendant={isOpen ? `${uid}-${active}` : undefined}
      onClick={() => { setActive(Math.max(0, selected)); setIsOpen(open => !open); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!isOpen) { setActive(Math.max(0, selected)); setIsOpen(true); return; }
          if (event.key === "Home") setActive(0);
          else if (event.key === "End") setActive(Math.max(0, options.length - 1));
          else setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(1, options.length));
        } else if (isOpen && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); choose(active); }
        else if (event.key === "Escape" && isOpen) { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "Tab") setIsOpen(false);
      }}>
      <span>{selected >= 0 ? options[selected].label : placeholder}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {isOpen && <div className="hk-custom-select__menu" role="listbox" id={`${uid}-list`} aria-label={ariaLabel || placeholder}>
      {options.map((option, index) => <div key={option.value} role="presentation">
        {option.group && option.group !== options[index - 1]?.group && <div className="hk-custom-select__group">{option.group}</div>}
        <button id={`${uid}-${index}`} type="button" tabIndex={-1} role="option" aria-selected={option.value === value} data-option-index={index}
          className={`hk-custom-select__option ${active === index ? "is-active" : ""}`} onMouseEnter={() => setActive(index)}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
          <span>{option.label}</span>{option.value === value && <Check size={14} aria-hidden="true" />}
        </button>
      </div>)}
    </div>}
  </div>;
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
