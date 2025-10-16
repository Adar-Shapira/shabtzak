import { useEffect } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  footer?: React.ReactNode; // new: allows passing action buttons (e.g., Cancel / Add)
};

export default function Modal({
  open,
  title,
  onClose,
  children,
  maxWidth = 560,
  footer,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: `min(94vw, ${maxWidth}px)`,
          background: "#1f2937",         // dark background
          color: "#e5e7eb",              // readable foreground
          border: "1px solid #374151",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.35)",
          overflow: "hidden",
          maxHeight: "85vh",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #374151",
            fontWeight: 600,
            position: "sticky",
            top: 0,
            background: "#1f2937",
            zIndex: 1,
          }}
        >
          {title ?? "Add"}
        </div>

        <div style={{ padding: 16, overflow: "auto" }}>{children}</div>

        {footer && (
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid #374151",
              display: "flex",
              gap: 12,
              justifyContent: "flex-end",
              position: "sticky",
              bottom: 0,
              background: "#1f2937",
              zIndex: 1,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
