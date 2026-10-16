"use client";

import { useState, type FormEvent } from "react";
import { formRequest, type User } from "@/lib/api";
import { Modal, PasswordField } from "./Modal";

type Props = { onClose: () => void; onSignedIn: (user: User) => void };

export function LoginModal({ onClose, onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("パスワードが一致しません。");
      return;
    }
    const result = await formRequest<User>("/api/auth/login", "POST", { email: email.trim(), password });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSignedIn(result.data);
  }

  return (
    <Modal title="ログイン" onClose={onClose}>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} autoComplete="username" autoFocus />
        </label>
        <label>
          パスワード
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" required />
        </label>
        <label>
          パスワード(確認)
          <PasswordField value={confirm} onChange={setConfirm} autoComplete="current-password" />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">ログイン</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function RegisterModal({ onClose, onSignedIn, onNeedLogin }: Props & { onNeedLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("パスワードが一致しません。");
      return;
    }
    const credentials = { email: email.trim(), password };
    const registered = await formRequest<User>("/api/users/register", "POST", credentials);
    if (!registered.ok) {
      setError(registered.message);
      return;
    }
    // 登録できたらそのままログインする。失敗したらログイン画面に切り替える
    const login = await formRequest<User>("/api/auth/login", "POST", credentials);
    if (!login.ok) {
      onNeedLogin();
      return;
    }
    onSignedIn(login.data);
  }

  return (
    <Modal title="新規登録" onClose={onClose}>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} autoComplete="username" autoFocus />
        </label>
        <label>
          <span>パスワード<span className="hint">(8文字以上)</span></span>
          <PasswordField value={password} onChange={setPassword} autoComplete="new-password" required minLength={8} />
        </label>
        <label>
          パスワード(確認)
          <PasswordField value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">登録</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function AccountModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const [email, setEmail] = useState(user.email);
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = { email: email.trim(), currentPassword };
    if (newPassword) body.newPassword = newPassword;
    const result = await formRequest<User>("/api/users/me", "PUT", body);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.data);
  }

  return (
    <Modal title="アカウント設定" onClose={onClose}>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} autoComplete="username" autoFocus />
        </label>
        <label>
          <span>新しいパスワード<span className="hint">(変更する場合のみ)</span></span>
          <PasswordField value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
        </label>
        <label>
          <span>現在のパスワード<span className="required">*</span></span>
          <PasswordField value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" required />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn-primary">保存</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
