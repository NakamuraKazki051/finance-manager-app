"use client";

import { useState, type ReactNode } from "react";

// 背景をクリックすると閉じるモーダル。Esc で閉じる処理は FinanceApp でまとめて行う
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
  autoComplete,
  required,
  minLength,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={72}
        minLength={minLength}
        required={required}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "パスワードを非表示" : "パスワードを表示"}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? "🙈" : "👁"}
      </button>
    </div>
  );
}
