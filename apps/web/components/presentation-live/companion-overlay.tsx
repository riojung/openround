"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocale } from "../locale-provider";
import styles from "./companion.module.css";

export function CompanionOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeButtonRef.current?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      aria-label={title}
      aria-modal="true"
      className={styles.overlay}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <h2>{title}</h2>
      {children}
      <button className="button full-width" onClick={onClose} ref={closeButtonRef} type="button">
        {t("live.companion.returnToDeck")}
      </button>
      <p className="muted">{t("live.companion.returnDescription")}</p>
    </dialog>
  );
}
