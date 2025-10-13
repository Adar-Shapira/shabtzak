import { useCallback, useState } from "react";

export function useDisclosure(defaultOpen = false) {
    const [isOpen, setOpen] = useState(defaultOpen);
    const open = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => setOpen(v => !v), []);
    return { isOpen, open, close, toggle };
}
