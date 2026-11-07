import { useId, useState } from "react";

const Eye = ({ open }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {!open && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);

/**
 * Password field with an eye button to show what was typed, plus live checks:
 * - `rules`: shows ✓ / ✗ for each rule as the person types,
 * - `matchWith`: for the "confirm password" field, shows whether both passwords are the same.
 */
export default function PasswordInput({ value, onChange, placeholder = "Password", autoComplete = "current-password", rules, matchWith, required = true, name }) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();
  const touched = value.length > 0;
  const matches = matchWith !== undefined && touched && value === matchWith;

  return (
    <div style={{ width: "100%", margin: "0 0 12px" }}>
      <div className="password-box">
        <input
          type={visible ? "text" : "password"}
          name={name}
          placeholder={placeholder}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-describedby={rules || matchWith !== undefined ? hintId : undefined}
          aria-invalid={matchWith !== undefined && touched && !matches ? true : undefined}
          style={matchWith !== undefined && touched ? { borderColor: matches ? "#16a34a" : "#dc2626" } : undefined}
        />
        <button
          type="button"
          className="eye-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, border: 0, cursor: "pointer" }}
        >
          <Eye open={!visible} />
        </button>
      </div>

      {rules && touched && (
        <ul id={hintId} style={{ listStyle: "none", padding: 0, margin: "6px 2px 0", display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 13, textAlign: "left" }}>
          {rules.map((r) => {
            const ok = r.test(value);
            return (
              <li key={r.label} style={{ color: ok ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
                {ok ? "✓" : "✗"} {r.label}
              </li>
            );
          })}
        </ul>
      )}

      {matchWith !== undefined && touched && (
        <p id={hintId} role="status" style={{ margin: "6px 2px 0", fontSize: 13, fontWeight: 700, textAlign: "left", color: matches ? "#15803d" : "#b91c1c" }}>
          {matches ? "✓ Passwords match" : "✗ Passwords do not match yet"}
        </p>
      )}
    </div>
  );
}
