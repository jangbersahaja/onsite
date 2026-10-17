"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { format } from "@/lib/i18n/format";
import { useRef } from "react";

type SixDigitPinInputProps = {
  idPrefix: string;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: "off" | "one-time-code";
};

export function SixDigitPinInput({
  idPrefix,
  label,
  name,
  value,
  onChange,
  autoComplete = "off",
}: SixDigitPinInputProps) {
  const { messages } = useLocale();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  function updateFromInput(index: number, input: string) {
    const digits = input.replace(/\D/g, "").slice(0, 6 - index);
    if (!digits) {
      onChange(
        index < value.length
          ? value.slice(0, index) + value.slice(index + 1)
          : value,
      );
      return;
    }

    const position = Math.min(index, value.length);
    const nextValue =
      value.slice(0, position) + digits + value.slice(position + digits.length);
    onChange(nextValue.slice(0, 6));
    inputRefs.current[Math.min(position + digits.length, 5)]?.focus();
  }

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <label className="pin-input-label" htmlFor={`${idPrefix}-1`}>
        {label}
      </label>
      <div className="pin-digit-group" role="group" aria-label={label}>
        {Array.from({ length: 6 }, (_, index) => (
          <input
            key={index}
            ref={(element) => {
              inputRefs.current[index] = element;
            }}
            id={`${idPrefix}-${index + 1}`}
            aria-label={format(messages.dialogs.pinInput.digitLabel, {
              label,
              position: index + 1,
            })}
            autoComplete={index === 0 ? autoComplete : "off"}
            inputMode="numeric"
            maxLength={6}
            type="password"
            value={value[index] ?? ""}
            onChange={(event) =>
              updateFromInput(index, event.currentTarget.value)
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                inputRefs.current[index - 1]?.focus();
              } else if (event.key === "ArrowRight" && index < 5) {
                event.preventDefault();
                inputRefs.current[index + 1]?.focus();
              } else if (
                event.key === "Backspace" &&
                !value[index] &&
                index > 0
              ) {
                event.preventDefault();
                onChange(value.slice(0, index - 1) + value.slice(index));
                inputRefs.current[index - 1]?.focus();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              updateFromInput(index, event.clipboardData.getData("text"));
            }}
          />
        ))}
      </div>
    </>
  );
}
