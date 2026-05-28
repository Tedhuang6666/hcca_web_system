"use client";
import { useCallback, useMemo, useState } from "react";

export type FieldValidator<T> = (value: T) => string | null;

/**
 * 表單欄位即時校驗：
 * - touched：欄位失焦過至少一次才顯示錯誤（避免使用者剛打開就紅一片）
 * - 提供 register(name) 給 input：onBlur / onChange 自動接線
 * - getError(name)：給 UI 渲染錯誤文案
 * - isValid()：給 submit button 判斷是否可送出
 *
 * 範例：
 *   const f = useFieldValidation({
 *     title: (v) => !v.trim() ? "必填" : v.length > 200 ? "最多 200 字" : null,
 *     email: (v) => /\S+@\S+\.\S+/.test(v) ? null : "Email 格式錯誤",
 *   });
 *   <input {...f.register("title", title, setTitle)} />
 *   {f.getError("title") && <p className="text-xs text-red-500">{f.getError("title")}</p>}
 */
export function useFieldValidation<TFields extends Record<string, unknown>>(
  validators: { [K in keyof TFields]: FieldValidator<TFields[K]> },
) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Partial<TFields>>({});

  const validate = useCallback(
    <K extends keyof TFields>(name: K, value: TFields[K]): string | null => {
      const validator = validators[name];
      if (!validator) return null;
      return validator(value);
    },
    [validators],
  );

  const errors = useMemo(() => {
    const out: Partial<Record<keyof TFields, string | null>> = {};
    for (const k in validators) {
      const v = values[k] as TFields[typeof k];
      out[k] = validate(k, v);
    }
    return out;
  }, [validators, values, validate]);

  const isValid = useMemo(
    () => Object.values(errors).every((e) => !e),
    [errors],
  );

  const register = <K extends keyof TFields>(
    name: K,
    value: TFields[K],
    onChange?: (next: TFields[K]) => void,
  ) => {
    return {
      value: value as unknown as string,
      onChange: (e: { target: { value: string } }) => {
        const next = e.target.value as unknown as TFields[K];
        setValues((prev) => ({ ...prev, [name]: next }));
        onChange?.(next);
      },
      onBlur: () => setTouched((prev) => ({ ...prev, [name as string]: true })),
      "aria-invalid": Boolean(touched[name as string] && errors[name]) || undefined,
    };
  };

  const getError = (name: keyof TFields): string | null =>
    touched[name as string] ? (errors[name] ?? null) : null;

  const markAllTouched = () => {
    const all: Record<string, boolean> = {};
    for (const k in validators) all[k] = true;
    setTouched(all);
  };

  return { register, getError, errors, isValid, markAllTouched };
}
