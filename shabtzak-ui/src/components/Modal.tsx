import { useEffect } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
    open: boolean;
    title?: string;
    onClose: () => void;
    children: React.ReactNode;
    maxWidth?: number;
};

export default function Modal({ open, title, onClose, children, maxWidth = 560 }: ModalProps) {
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
            position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
            display: "grid", placeItems: "center", zIndex: 9999,
        }}
        >
        <div
            style={{
            width: "min(94vw, "+maxWidth+"px)", background: "#fff",
            borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            overflow: "hidden",
            }}
        >
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #eee", fontWeight: 600 }}>
            {title ?? "Add"}
            </div>
            <div style={{ padding: 16 }}>
            {children}
            </div>
        </div>
        </div>,
        document.body
    );
}
