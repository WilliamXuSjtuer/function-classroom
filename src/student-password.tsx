import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import {
  passwordMaxLength,
  studentPasswordMinLength,
} from "../shared/password";
import { post } from "./api";
import { Modal } from "./components";

export function StudentPassword({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const currentPassword = fields.get("currentPassword");
    const newPassword = fields.get("newPassword");
    if (newPassword !== fields.get("confirmation")) {
      setError("两次输入的新密码不一致，请再核对一次。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await post("/me/password", { currentPassword, newPassword });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="text-button"
        onClick={() => {
          setError("");
          setSaved(false);
          setOpen(true);
        }}
      >
        <KeyRound size={16} /> 修改密码
      </button>
      {open && (
        <Modal
          title="修改密码"
          onClose={() => setOpen(false)}
          closeDisabled={busy}
        >
          {saved ? (
            <>
              <p role="status">
                密码已修改。你可以继续上课，下次登录请使用新密码。
              </p>
              <div className="modal-actions">
                <button
                  className="button primary"
                  onClick={() => setOpen(false)}
                >
                  完成
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <input
                type="hidden"
                name="username"
                autoComplete="username"
                value={username}
              />
              <label>
                当前密码
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  maxLength={passwordMaxLength}
                  required
                />
              </label>
              <label>
                新密码
                <input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  placeholder={`${studentPasswordMinLength}–${passwordMaxLength} 个字符`}
                  minLength={studentPasswordMinLength}
                  maxLength={passwordMaxLength}
                  required
                />
              </label>
              <label>
                确认新密码
                <input
                  type="password"
                  name="confirmation"
                  autoComplete="new-password"
                  maxLength={passwordMaxLength}
                  required
                />
              </label>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <p className="muted">
                修改后，其他设备需要重新登录。忘记当前密码时，可以请任课教师重置。
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  取消
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? "正在保存…" : "保存新密码"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
