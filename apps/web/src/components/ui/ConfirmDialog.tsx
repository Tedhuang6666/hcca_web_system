"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import Modal from "./Modal";

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger=true：確認按鈕為紅色，預設為主色。 */
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface ConfirmState extends ConfirmOptions {
  resolver: Resolver;
}

/**
 * 全域確認對話框 provider。包在 AppShell 或 layout 內後，
 * 任何子元件都可用 useConfirm() 呼叫。
 *
 * 範例：
 * const confirm = useConfirm();
 * if (await confirm({ title: "確定要刪除？", danger: true })) {
 *   await api.delete(...);
 * }
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, resolver: resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    if (state) {
      state.resolver(result);
      setState(null);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <Modal
          title={state.title}
          size="sm"
          mobileFullscreen={false}
          onClose={() => handleClose(false)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => handleClose(false)}>
                {state.cancelLabel ?? "取消"}
              </button>
              <button
                type="button"
                className={`btn ${state.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => handleClose(true)}
                autoFocus
                style={state.danger ? {
                  background: "var(--danger)",
                  color: "#fff",
                  border: "1px solid var(--danger)",
                } : undefined}>
                {state.confirmLabel ?? "確定"}
              </button>
            </>
          }>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {state.description ?? "此動作無法復原，請再次確認。"}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // 開發時的 fallback：用 window.confirm（非 hook 但仍可運作）
    return ({ title, description }: ConfirmOptions) =>
      Promise.resolve(window.confirm(`${title}\n\n${description ?? ""}`));
  }
  return ctx.confirm;
}
