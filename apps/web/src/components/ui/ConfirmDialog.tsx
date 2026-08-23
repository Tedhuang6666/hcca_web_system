"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleHelp, Pencil, TriangleAlert } from "lucide-react";
import Modal from "./Modal";
import styles from "./InteractionMotion.module.css";

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger=true：確認按鈕為紅色，預設為主色。 */
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}

type Resolver = (ok: boolean) => void;
type PromptResolver = (value: string | null) => void;

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface ConfirmState extends ConfirmOptions {
  kind: "confirm";
  resolver: Resolver;
}

interface PromptState extends PromptOptions {
  kind: "prompt";
  resolver: PromptResolver;
}

type DialogState = ConfirmState | PromptState;

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
  const [state, setState] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState("");

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, kind: "confirm", resolver: resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      setInputValue(opts.defaultValue ?? "");
      setState({ ...opts, kind: "prompt", resolver: resolve });
    });
  }, []);

  const closeConfirm = (result: boolean) => {
    if (state?.kind === "confirm") {
      state.resolver(result);
      setState(null);
    }
  };

  const closePrompt = (value: string | null) => {
    if (state?.kind === "prompt") {
      state.resolver(value);
      setState(null);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      {state && (
        <Modal
          title={state.title}
          size="sm"
          mobileFullscreen={false}
          onClose={() => state.kind === "confirm" ? closeConfirm(false) : closePrompt(null)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => state.kind === "confirm" ? closeConfirm(false) : closePrompt(null)}
                data-autofocus>
                {state.cancelLabel ?? "取消"}
              </button>
              <button
                type="button"
                className={`btn ${state.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => {
                  if (state.kind === "confirm") closeConfirm(true);
                  else closePrompt(inputValue);
                }}
                disabled={state.kind === "prompt" && state.required && !inputValue.trim()}
                style={state.danger ? {
                  background: "var(--danger)",
                  color: "#fff",
                  border: "1px solid var(--danger)",
                } : undefined}>
                {state.confirmLabel ?? "確定"}
              </button>
            </>
          }>
          <div
            className={`${styles.confirmContent} confirm-dialog-content space-y-3 text-sm`}
            data-dialog-kind={state.kind}
            style={{ color: "var(--text-secondary)" }}
          >
            <span
              className={styles.confirmMarker}
              data-tone={state.danger ? "danger" : state.kind === "prompt" ? "prompt" : "neutral"}
              aria-hidden="true"
            >
              {state.danger ? <TriangleAlert size={17} /> : state.kind === "prompt" ? <Pencil size={16} /> : <CircleHelp size={17} />}
            </span>
            {state.description && <div>{state.description}</div>}
            {state.kind === "prompt" && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium">{state.inputLabel ?? "請輸入內容"}</span>
                <input
                  data-autofocus
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (!state.required || inputValue.trim())) {
                      event.preventDefault();
                      closePrompt(inputValue);
                    }
                  }}
                  placeholder={state.placeholder}
                  className="input w-full"
                  aria-required={state.required || undefined}
                />
              </label>
            )}
            {state.kind === "confirm" && !state.description && "此動作無法復原，請再次確認。"}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm 必須在 ConfirmProvider 內使用");
  }
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("usePrompt 必須在 ConfirmProvider 內使用");
  }
  return ctx.prompt;
}
