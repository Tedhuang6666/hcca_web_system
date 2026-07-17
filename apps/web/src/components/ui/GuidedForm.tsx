"use client";

import type { ReactNode } from "react";

import FormShell from "./FormShell";

export type GuidedFormStepDefinition = {
  label: string;
  description: string;
};

type GuidedFormProps = {
  children: ReactNode;
  steps: GuidedFormStepDefinition[];
  activeStep: number;
  onStepChange: (step: number) => void;
  onBack: () => void;
  onNext: () => void;
  onSave: () => void;
  saveLabel: string;
  saving?: boolean;
  draftStatus?: string;
  finalAction?: ReactNode;
  secondarySaveAction?: { label: string; onClick: () => void };
};

type GuidedFormStepProps = {
  children: ReactNode;
  step: number;
  activeStep: number;
  className?: string;
};

export function GuidedFormStep({ children, step, activeStep, className }: GuidedFormStepProps) {
  return (
    <section className={`${step === activeStep ? "block" : "hidden"} md:block ${className ?? ""}`}>
      {children}
    </section>
  );
}

export default function GuidedForm({
  children,
  steps,
  activeStep,
  onStepChange,
  onBack,
  onNext,
  onSave,
  saveLabel,
  saving = false,
  draftStatus,
  finalAction,
  secondarySaveAction,
}: GuidedFormProps) {
  const isLastStep = activeStep === steps.length - 1;
  const active = steps[activeStep];

  return (
    <FormShell
      className="guided-form-shell"
      footerClassName="md:hidden"
      footer={(
        <div className="flex w-full items-center gap-2">
          {activeStep > 0 && (
            <button type="button" className="btn btn-ghost flex-1" onClick={onBack} disabled={saving}>
              上一步
            </button>
          )}
          {!isLastStep ? (
            <button type="button" className="btn btn-primary flex-[2]" onClick={onNext} disabled={saving}>
              下一步
            </button>
          ) : (
            <>
              {secondarySaveAction && (
                <button
                  type="button"
                  className="btn btn-ghost flex-1"
                  onClick={secondarySaveAction.onClick}
                  disabled={saving}>
                  {secondarySaveAction.label}
                </button>
              )}
              <button type="button" className="btn btn-primary flex-[2]" onClick={onSave} disabled={saving}>
                {saving ? "儲存中…" : saveLabel}
              </button>
            </>
          )}
        </div>
      )}>
      <nav className="mb-4 md:hidden" aria-label="建立步驟">
        <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          第 {activeStep + 1} 步，共 {steps.length} 步 · {active.label}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{active.description}</p>
        <ol className="mt-3 flex gap-1.5" aria-label="步驟進度">
          {steps.map((step, index) => (
            <li key={step.label} className="flex-1">
              <button
                type="button"
                className="h-2 w-full rounded-full transition-colors"
                style={{
                  background: index <= activeStep ? "var(--primary)" : "var(--border)",
                }}
                onClick={() => index <= activeStep && onStepChange(index)}
                disabled={index > activeStep}
                aria-label={`前往${step.label}`}
                aria-current={index === activeStep ? "step" : undefined}
              />
            </li>
          ))}
        </ol>
        {draftStatus && (
          <p className="mt-2 text-xs" role="status" style={{ color: "var(--text-muted)" }}>
            {draftStatus}
          </p>
        )}
      </nav>
      {children}
      {finalAction}
    </FormShell>
  );
}
