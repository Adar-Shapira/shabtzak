// shabtzak-ui/src/pages/Soldiers.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { api } from "../api";
import Modal from "../components/Modal";
import { useDisclosure } from "../hooks/useDisclosure";
import { listMissions, getSoldierMissionRestrictions, putSoldierMissionRestrictions, type Mission } from "../api";
import SoldierHistoryModal from "../components/SoldierHistoryModal"
import { useSidebar } from "../contexts/SidebarContext";


type Role = { 
    id: number; 
    name: string; 
 };

type Department = { 
    id: number; 
    name: string 
};

type Vacation = {
    id: number;
    soldier_id: number;
    start_date: string; // ISO yyyy-mm-dd
    end_date: string;   // ISO yyyy-mm-dd
    note?: string | null;
};

type Soldier = {
    id: number;
    name: string;
    roles: { id: number; name: string }[];  // ← server already returns this
    department_id?: number | null;
    department_name?: string | null;
    restrictions: string;
    restrictions_tokens?: string[];
};


function tokensToArray(s: string | undefined | null): string[] {
    if (!s) return [];
    return s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

function byName(a: Soldier, b: Soldier) {
  return a.name.localeCompare(b.name);
}

function RolePill({ name }: { name: string }) {
  return (
    <span
      style={{
        color: "#10b981", // green-500
        border: "1px solid currentColor",
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: "0.85em",
        fontWeight: 600,
        display: "inline-block",
        lineHeight: 1.3,
      }}
    >
      {name}
    </span>
  );
}

function RestrictionsPill({ name }: { name: string }) {
  return (
    <span
      style={{
        color: "#a855f7", // purple-500
        border: "1px solid currentColor",
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: "0.85em",
        fontWeight: 600,
        display: "inline-block",
        lineHeight: 1.3,
      }}
    >
      {name}
    </span>
  );
}

function MultiSelectDropdown<T extends string | number>({
  options,
  selected,
  onChange,
  placeholder,
  getLabel,
}: {
  options: T[];
  selected: T[];
  onChange: (selected: T[]) => void;
  placeholder: string;
  getLabel: (option: T) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        });
      }
    };

    if (isOpen) {
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
    }

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  const toggleOption = (option: T) => {
    if (selected.includes(option)) {
      onChange(selected.filter(item => item !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const selectedLabels = selected.map(getLabel);

  const dropdownContent = isOpen ? (
    <div
      ref={dropdownRef}
      style={{
        position: "fixed",
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        width: `${dropdownPosition.width}px`,
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        border: "1px solid #1f2937",
        borderRadius: 8,
        maxHeight: 200,
        overflowY: "auto",
        zIndex: 10000,
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
        direction: "rtl",
      }}
    >
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <label
            key={String(option)}
            style={{
              display: "flex",
              alignItems: "center",
              flexDirection: "row-reverse",
              justifyContent: "space-between",
              padding: "8px 12px",
              cursor: "pointer",
              backgroundColor: isSelected ? "rgba(16, 185, 129, 0.1)" : "transparent",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleOption(option)}
              style={{
                cursor: "pointer",
              }}
            />
            <span style={{ color: "#e5e7eb", fontSize: 14, flex: 1, direction: "rtl", textAlign: "right" }}>
              {getLabel(option)}
            </span>
          </label>
        );
      })}
      {options.length === 0 && (
        <div style={{ padding: "12px", color: "#9ca3af", fontSize: 14, textAlign: "center" }}>
          אין אפשרויות
        </div>
      )}
    </div>
  ) : null;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #1f2937",
          backgroundColor: "rgba(255,255,255,0.03)",
          color: "#e5e7eb",
          fontSize: 14,
          textAlign: "right",
          direction: "rtl",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "right" }}>
          {selected.length === 0
            ? placeholder
            : selected.length === 1
            ? selectedLabels[0]
            : `${selected.length} נבחרו`}
        </span>
        <span style={{ marginRight: 8, fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
      </button>

      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
}

export default function SoldiersPage() {
    const { setActions } = useSidebar();
    
    const [roles, setRoles] = useState<Role[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [missions, setMissions] = useState<Mission[]>([]);
    const restrictionOptions = useMemo(
        () => Array.from(new Set(missions.map(m => m.name))).sort(), [missions]);

    const [soldiers, setSoldiers] = useState<Soldier[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterRole, setFilterRole] = useState<string>("");

    const addDlg = useDisclosure(false);

    // CREATE
    const [newName, setNewName] = useState("");
    const [newRoleIds, setNewRoleIds] = useState<number[]>([]);
    const [newDeptId, setNewDeptId] = useState<number | "">("");
    const [newRestrictions, setNewRestrictions] = useState<string[]>([]);

    // EDIT
    const [editId, setEditId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editRoleIds, setEditRoleIds] = useState<number[]>([]);
    const [editDeptId, setEditDeptId] = useState<number | "">("");
    const [editRestrictions, setEditRestrictions] = useState<string[]>([]);

    // --- Department CRUD (moved from Departments page) ---
    const deptDlg = useDisclosure(false);           // controls the add/edit department modal
    const [deptEditId, setDeptEditId] = useState<number | null>(null);
    const [deptName, setDeptName] = useState("");  // input for add/rename

    const [allMissions, setAllMissions] = useState<Mission[]>([]);
    const [savingRestr, setSavingRestr] = useState<number | null>(null); // soldier id being saved
    const [restrCache, setRestrCache] = useState<Record<number, number[]>>({}); // soldier_id -> mission_ids

    const restrDlg = useDisclosure(false);
    const [restrSoldier, setRestrSoldier] = useState<Soldier | null>(null);

    const [historyFor, setHistoryFor] = useState<{ id: number; name: string } | null>(null)

    // Confirmation modal for deletions
    const confirmDlg = useDisclosure(false);
    const [confirmMessage, setConfirmMessage] = useState<string>("");
    const [pendingDelete, setPendingDelete] = useState<{ type: "soldier" | "department" | "role" | "vacation"; id: number; name?: string; vacation?: Vacation; soldierId?: number } | null>(null);


    const openRestrictions = async (s: Soldier) => {
    setErr(null);
    setRestrSoldier(s);
    if (!restrCache[s.id]) {
        try {
        const res = await getSoldierMissionRestrictions(s.id);
        setRestrCache(prev => ({ ...prev, [s.id]: res.mission_ids }));
        } catch {
        setRestrCache(prev => ({ ...prev, [s.id]: [] }));
        }
    }
    restrDlg.open();
    };

    const closeRestrictions = () => {
    setRestrSoldier(null);
    restrDlg.close();
    };

    useEffect(() => {
    listMissions().then(setAllMissions).catch(() => setAllMissions([]));
    }, []);

    const startAddDept = () => {
    setDeptEditId(null);
    setDeptName("");
    deptDlg.open();
    };

    const startEditDept = (id: number, name: string) => {
    setDeptEditId(id);
    setDeptName(name);
    deptDlg.open();
    };

    const cancelDeptDialog = () => {
    setDeptEditId(null);
    setDeptName("");
    deptDlg.close();
    };

    const saveDept = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
        if (deptEditId == null) {
        // create
        await api.post("/departments", { name: deptName.trim() });
        } else {
        // rename
        await api.patch(`/departments/${deptEditId}`, { name: deptName.trim() });
        }
        cancelDeptDialog();
        await loadAll(); // refresh groups and selects
    } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to save department");
    }
    };

    const showConfirmDeleteDept = (id: number, name: string) => {
        setConfirmMessage(`האם למחוק את המחלקה "${name}"? (חסום אם יש חיילים משובצים)`);
        setPendingDelete({ type: "department", id, name });
        confirmDlg.open();
    };

    const deleteDept = (id: number, name: string) => {
        showConfirmDeleteDept(id, name);
    };

    // --- Roles CRUD (moved from Roles page) ---
    const rolesDlg = useDisclosure(false);
    const [roleEditId, setRoleEditId] = useState<number | null>(null);
    const [roleName, setRoleName] = useState("");
    const [editRoleName, setEditRoleName] = useState(""); // Separate state for inline editing
    const [isRoleFormOpen, setIsRoleFormOpen] = useState(false);

    const startAddRole = () => {
    setRoleEditId(null);
    setRoleName("");
    setIsRoleFormOpen(true);
    rolesDlg.open();
    };

    const startEditRole = (id: number, name: string) => {
    setRoleEditId(id);
    setEditRoleName(name); // Use separate state for inline editing
    // Keep the add form open - editing happens inline in the row
    if (!rolesDlg.isOpen) {
        rolesDlg.open();
    }
    };

    const cancelEditRole = () => {
    setRoleEditId(null);
    setEditRoleName("");
    };

    const cancelRoleDialog = () => {
    setRoleEditId(null);
    setRoleName("");
    setEditRoleName("");
    setIsRoleFormOpen(false);
    rolesDlg.close();
    };

    const saveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
        await api.post("/roles", { name: roleName.trim() });
        // Keep form open for adding more roles, just clear the input
        setRoleName("");
        await loadAll();
    } catch (e: any) {
        setErr(e?.response?.data?.detail ?? "Failed to save role");
    }
    };

    const saveEditRole = async (id: number) => {
        if (!editRoleName.trim()) return;
        setErr(null);
        try {
            await api.patch(`/roles/${id}`, { name: editRoleName.trim() });
            setRoleEditId(null);
            setEditRoleName("");
            await loadAll();
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to save role");
        }
    };

    const showConfirmDeleteRole = (id: number, name: string) => {
        setConfirmMessage(`האם למחוק את התפקיד "${name}"? (חסום אם משובץ לחיילים)`);
        setPendingDelete({ type: "role", id, name });
        confirmDlg.open();
    };

    const deleteRole = (id: number, name: string) => {
        showConfirmDeleteRole(id, name);
    };

    // --- Vacations per Soldier ---
    const vacDlg = useDisclosure(false);
    const [vacSoldier, setVacSoldier] = useState<Soldier | null>(null);
    const [vacations, setVacations] = useState<Vacation[]>([]);

    // vacation form state
    const [vacEditId, setVacEditId] = useState<number | null>(null);
    const [vacStart, setVacStart] = useState<string>("");
    const [vacEnd, setVacEnd] = useState<string>("");
    const [vacNote, setVacNote] = useState<string>("");

    const openVacations = async (s: Soldier) => {
        setErr(null);
        setVacSoldier(s);

        // Reset form
        setVacEditId(null);
        setVacStart("");
        setVacEnd("");
        setVacNote("");

        await fetchVacations(s.id);   // load first
        vacDlg.open();                // then open with data already in state
    };

    const closeVacations = () => {
    setVacSoldier(null);
    setVacations([]);
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    vacDlg.close();
    };

    const startAddVacation = () => {
    setVacEditId(null);
    setVacStart("");
    setVacEnd("");
    setVacNote("");
    };

    const startEditVacation = (v: Vacation) => {
    setVacEditId(v.id);
    setVacStart(v.start_date);
    setVacEnd(v.end_date);
    setVacNote(v.note ?? "");
    };

    const saveVacation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!vacSoldier) return;

        if (vacStart && vacEnd && vacEnd < vacStart) {
            alert("End date cannot be before start date.");
            return;
        }

        setErr(null);
        try {
            const payload = { start_date: vacStart, end_date: vacEnd, note: vacNote || null };

            if (vacEditId == null) {
            // CREATE
            let created: Vacation | null = null;
            try {
                const r = await api.post(`/soldiers/${vacSoldier.id}/vacations`, payload);
                created = r.data as Vacation;
            } catch (e: any) {
                if (e?.response?.status === 404) {
                const r = await api.post(`/vacations`, { ...payload, soldier_id: vacSoldier.id });
                created = r.data as Vacation;
                } else {
                throw e;
                }
            }

            // If backend returned the created row, update immediately; otherwise hard refresh.
            if (created && created.id) {
                setVacations(prev => [...prev, created!]);
            } else {
                await fetchVacations(vacSoldier.id);
            }
            } else {
            // UPDATE
            let updated: Vacation | null = null;
            try {
                const r = await api.patch(`/soldiers/${vacSoldier.id}/vacations/${vacEditId}`, payload);
                updated = r.data as Vacation;
            } catch (e: any) {
                if (e?.response?.status === 404) {
                const r = await api.patch(`/vacations/${vacEditId}`, { ...payload, soldier_id: vacSoldier.id });
                updated = r.data as Vacation;
                } else {
                throw e;
                }
            }

            // If backend returned the updated row, merge it; otherwise hard refresh.
            if (updated && updated.id) {
                setVacations(prev => prev.map(v => (v.id === updated!.id ? updated! : v)));
            } else {
                await fetchVacations(vacSoldier.id);
            }
            }

            // Reset form
            setVacEditId(null);
            setVacStart("");
            setVacEnd("");
            setVacNote("");

        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to save vacation");
        }
    };

    const fetchVacations = async (soldierId: number) => {
        // helper to normalize IDs to numbers (handles string/number mismatches)
        const sameId = (x: any, y: any) => Number(x) === Number(y);

        try {
            // 1) Try soldier-scoped endpoint
            try {
            const r = await api.get(`/soldiers/${soldierId}/vacations`, { params: { t: Date.now() } });
            const payload = r.data ?? [];
            const items = Array.isArray(payload) ? payload : (payload.items ?? payload.results ?? []);
            // Even if the API misbehaves, enforce client-side filter:
            setVacations(items.filter((v: Vacation) => sameId(v.soldier_id, soldierId)));

            return;
            } catch (_e) {
            // fall through
            }

            // 2) Try global endpoint with common param names
            const tryGlobal = async (param: string) => {
            const r = await api.get(`/vacations`, { params: { [param]: soldierId, t: Date.now() } });
            const payload = r.data ?? [];
            const items = Array.isArray(payload) ? payload : (payload.items ?? payload.results ?? []);
            // Force client-side filter in case the backend ignores the param:
            setVacations(items.filter((v: Vacation) => sameId(v.soldier_id, soldierId)));

            return true;
            };

            const ok =
            (await tryGlobal("soldier_id").catch(() => false)) ||
            (await tryGlobal("soldierId").catch(() => false)) ||
            (await tryGlobal("sid").catch(() => false));

            if (!ok) {
            setErr("Failed to load vacations: no matching endpoint");
            // Keep whatever we had; don't clear the list
            }
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to load vacations");
        } finally {
        }
    };

    const showConfirmDeleteVacation = (v: Vacation) => {
        if (!vacSoldier) return;
        const dateRange = `${v.start_date} → ${v.end_date}`;
        setConfirmMessage(`האם למחוק את החופשה ${dateRange}?`);
        setPendingDelete({ type: "vacation", id: v.id, vacation: v, soldierId: vacSoldier.id });
        confirmDlg.open();
    };

    const deleteVacation = (v: Vacation) => {
        showConfirmDeleteVacation(v);
    };

    const executeDeleteVacation = async (v: Vacation, soldierId: number) => {
        setErr(null);
        try {
            let ok = false;
            try {
            const r = await api.delete(`/soldiers/${soldierId}/vacations/${v.id}`);
            ok = r.status >= 200 && r.status < 300;
            } catch (e: any) {
            if (e?.response?.status === 404) {
                const r = await api.delete(`/vacations/${v.id}`);
                ok = r.status >= 200 && r.status < 300;
            } else {
                throw e;
            }
            }
            // Optimistic remove
            if (ok) {
            setVacations(prev => prev.filter(x => x.id !== v.id));
            } else {
            await fetchVacations(soldierId);
            }
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to delete vacation");
        }
    };

    // DELETE
    const showConfirmDeleteSoldier = (id: number) => {
        const soldier = soldiers.find(s => s.id === id);
        const soldierName = soldier ? soldier.name : "חייל זה";
        setConfirmMessage(`האם למחוק את ${soldierName}? (חסום אם יש שיבוצים)`);
        setPendingDelete({ type: "soldier", id, name: soldierName });
        confirmDlg.open();
    };

    const executeDelete = async () => {
        if (!pendingDelete) return;
        
        setErr(null);
        try {
            if (pendingDelete.type === "department") {
                await api.delete(`/departments/${pendingDelete.id}`);
                await loadAll();
            } else if (pendingDelete.type === "role") {
                await api.delete(`/roles/${pendingDelete.id}`);
                await loadAll();
            } else if (pendingDelete.type === "vacation") {
                if (pendingDelete.vacation && pendingDelete.soldierId) {
                    await executeDeleteVacation(pendingDelete.vacation, pendingDelete.soldierId);
                }
            } else {
                await api.delete(`/soldiers/${pendingDelete.id}`);
                await loadAll();
            }
            setPendingDelete(null);
            confirmDlg.close();
        } catch (e: any) {
            let errorMsg = "Failed to delete";
            if (pendingDelete.type === "department") {
                errorMsg = "Failed to delete department";
            } else if (pendingDelete.type === "role") {
                errorMsg = "Failed to delete role";
            } else if (pendingDelete.type === "vacation") {
                errorMsg = "Failed to delete vacation";
            } else {
                errorMsg = "Failed to delete soldier";
            }
            setErr(e?.response?.data?.detail ?? errorMsg);
            setPendingDelete(null);
            confirmDlg.close();
        }
    };

    const removeSoldier = (id: number) => {
        showConfirmDeleteSoldier(id);
    };

    const loadAll = async () => {
        setLoading(true); setErr(null);
        try {
            const [r, d, s, m] = await Promise.all([
                api.get<Role[]>("/roles"),
                api.get<Department[]>("/departments"),
                api.get<Soldier[]>("/soldiers"),
                api.get<Mission[]>("/missions"),
            ]);
            setRoles(r.data);
            setDepartments(d.data);
            setSoldiers(s.data as Soldier[]);
            setMissions(m.data.map(x => ({ id: x.id, name: x.name })));
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, []);

    // Register sidebar actions
    useEffect(() => {
        setActions({
            onAddSoldier: () => {
                addDlg.open();
            },
            onAddDepartment: () => {
                startAddDept();
            },
            onManageRoles: () => {
                startAddRole();
            },
        });
        return () => setActions({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setActions]);

    // Always refresh the list whenever the Vacations modal opens
    useEffect(() => {
        if (vacDlg.isOpen && vacSoldier) {
            fetchVacations(vacSoldier.id);
        }
    }, [vacDlg.isOpen, vacSoldier?.id]);

    // Filter soldiers based on search query and role filter
    const filteredSoldiers = useMemo(() => {
        let result = soldiers;

        // Filter by name search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            result = result.filter(s => s.name.toLowerCase().includes(query));
        }

        // Filter by role
        if (filterRole) {
            result = result.filter(s => 
                s.roles?.some(r => r.name === filterRole)
            );
        }

        return result;
    }, [soldiers, searchQuery, filterRole]);

    // Sorted roles for dropdown
    const sortedRoles = useMemo(() => {
        return [...roles].sort((a, b) => a.name.localeCompare(b.name));
    }, [roles]);

    // Default department (lowest ID)
    const defaultDepartmentId = useMemo(() => {
        if (departments.length === 0) return null;
        return departments.reduce((lowest, current) => 
            current.id < lowest.id ? current : lowest
        ).id;
    }, [departments]);

    // Set default department when modal opens
    useEffect(() => {
        if (addDlg.isOpen && !newDeptId && defaultDepartmentId) {
            setNewDeptId(defaultDepartmentId);
        }
    }, [addDlg.isOpen, defaultDepartmentId, newDeptId]);

    // Build a department → soldiers map that also includes empty departments
    const { groupsByDeptId, unassigned } = useMemo(() => {
        const byId = new Map<number, Soldier[]>();
        // Ensure every known department exists, even if empty
        for (const d of departments) byId.set(d.id, []);

        const none: Soldier[] = [];
        for (const s of filteredSoldiers) {
            if (s.department_id != null && byId.has(s.department_id)) {
            byId.get(s.department_id)!.push(s);
            } else {
            // includes null/undefined or stale dept_id not in list
            none.push(s);
            }
        }
        // sort each department's soldiers
        for (const [, arr] of byId) arr.sort(byName);
        none.sort(byName);

        return { groupsByDeptId: byId, unassigned: none };
        }, [departments, filteredSoldiers]);

        // Sorted departments A→Z (drive UI from departments, not soldiers)
        const sortedDepartments = useMemo(
        () => [...departments].sort((a, b) => a.name.localeCompare(b.name)),
        [departments]
    );

    // helpers for <select multiple>
    const onMultiChangeStrings = (ev: React.ChangeEvent<HTMLSelectElement>, setState: (vals: string[]) => void) => {
        const opts = Array.from(ev.target.selectedOptions).map(o => String(o.value));
        setState(opts);
    };

    // CREATE
    const createSoldier = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);
        try {
            const deptId = newDeptId || defaultDepartmentId;
            await api.post("/soldiers", {
            name: newName.trim(),
            role_ids: newRoleIds,
            department_id: deptId ? Number(deptId) : null,
            restrictions: newRestrictions,
            });

            // resets:
            setNewName("");
            setNewRoleIds([]);
            setNewDeptId(defaultDepartmentId ?? "");
            setNewRestrictions([]);
            addDlg.close();
            await loadAll();

        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to create soldier");
        }
    };



    // EDIT
    const startEdit = (s: Soldier) => {
        setEditId(s.id);
        setEditName(s.name);
        setEditRoleIds((s.roles ?? []).map(r => r.id));   // ← use roles array
        setEditDeptId(s.department_id ?? "");
        setEditRestrictions(s.restrictions_tokens ?? tokensToArray(s.restrictions));
    };


    const cancelEdit = () => {
        setEditId(null);
        setEditName("");
        setEditRoleIds([]);          // ← reset roles
        setEditDeptId("");
        setEditRestrictions([]);
    };


    const saveEdit = async (id: number) => {
        try {
            const deptId = editDeptId || defaultDepartmentId;
            await api.patch(`/soldiers/${id}`, {
                name: editName.trim(),
                role_ids: editRoleIds,
                department_id: deptId ? Number(deptId) : null,
                restrictions: editRestrictions,
            });


            setEditId(null);
            await loadAll();
        } catch (e: any) {
            setErr(e?.response?.data?.detail ?? "Failed to update soldier");
        }   
    };

    return (
        <div style={{ maxWidth: 1200, margin: "24px auto", padding: 16, fontFamily: "sans-serif" }}>


            <Modal open={addDlg.isOpen} onClose={addDlg.close} title="הוסף חייל" maxWidth={720}>
                <form
                    onSubmit={createSoldier}
                    style={{ display: "grid", gap: 16 }}
                >
                    {/* Name */}
                    <div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>שם מלא</div>
                        <input 
                            value={newName} 
                            onChange={(e)=>setNewName(e.target.value)} 
                            placeholder="שם מלא" 
                            required 
                            style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 8,
                                border: "1px solid #1f2937",
                                backgroundColor: "rgba(255,255,255,0.03)",
                                color: "#e5e7eb",
                                fontSize: 14,
                            }}
                        />
                    </div>

                    {/* Roles, Department, and Restrictions Row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                        {/* Roles multi */}
                        <div>
                            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>תפקיד</div>
                            <MultiSelectDropdown
                                options={sortedRoles.map(r => r.id)}
                                selected={newRoleIds}
                                onChange={setNewRoleIds}
                                placeholder="בחר תפקידים"
                                getLabel={(id) => {
                                    const role = sortedRoles.find(r => r.id === id);
                                    return role?.name || String(id);
                                }}
                            />
                        </div>

                        {/* Department */}
                        <div>
                            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>מחלקה</div>
                            <select 
                                value={(newDeptId || defaultDepartmentId) ?? ""} 
                                onChange={(e)=>setNewDeptId(Number(e.target.value))} 
                                required
                                disabled={departments.length === 0}
                                style={{ 
                                    width: "100%",
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    border: "1px solid #1f2937",
                                    backgroundColor: "rgba(255,255,255,0.03)",
                                    color: "#e5e7eb",
                                    fontSize: 14,
                                    cursor: "pointer",
                                    direction: "rtl",
                                    textAlign: "right",
                                }}
                            >
                                {departments.map(d => <option key={d.id} value={d.id} style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>{d.name}</option>)}
                            </select>
                        </div>

                        {/* Restrictions */}
                        <div>
                            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>הגבלות</div>
                            <MultiSelectDropdown
                                options={restrictionOptions}
                                selected={newRestrictions}
                                onChange={setNewRestrictions}
                                placeholder="בחר הגבלות"
                                getLabel={(option) => option}
                            />
                        </div>
                    </div>

                    {/* Buttons */}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                        <button type="button" onClick={addDlg.close}>בטל</button>
                        <button type="submit">הוסף</button>
                    </div>
                </form>
            </Modal>

            {/* Add/Rename Department Modal */}
            <Modal open={deptDlg.isOpen} onClose={cancelDeptDialog} title={deptEditId == null ? "הוסף מחלקה" : "שנה שם"} maxWidth={480}>
                <form onSubmit={saveDept} style={{ display: "grid", gap: 10 }}>
                    <input
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    placeholder="שם מחלקה"
                    required
                    />
                    <div style={{ display: "flex", justifyContent: "end", gap: 8 }}>
                        <button type="button" onClick={cancelDeptDialog}>בטל</button>
                        <button type="submit">{deptEditId == null ? "הוסף" : "שמור"}</button>
                    </div>
                </form>
            </Modal>

            {/* Roles Modal */}
            <Modal open={rolesDlg.isOpen} onClose={cancelRoleDialog} title="נהל תפקידים" maxWidth={640}>
                <div style={{ display: "grid", gap: 12 }}>
                    {/* Toolbar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    </div>

                    {/* Add role form at top */}
                    {isRoleFormOpen && (
                        <form onSubmit={saveRole} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
                            <input
                            value={roleName}
                            onChange={(e) => setRoleName(e.target.value)}
                            placeholder="תפקיד"
                            required
                            style={{
                                padding: "8px 12px",
                                borderRadius: 8,
                                border: "1px solid #1f2937",
                                backgroundColor: "rgba(255,255,255,0.03)",
                                color: "#e5e7eb",
                                fontSize: 14,
                            }}
                            />
                            <button type="submit" style={{
                                padding: "8px 16px",
                                borderRadius: 8,
                                border: "1px solid #1f2937",
                                backgroundColor: "rgba(255,255,255,0.03)",
                                color: "#e5e7eb",
                                cursor: "pointer",
                            }}>
                                הוסף
                            </button>
                        </form>
                    )}

                    {/* Roles list */}
                    <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
                    <thead>
                        <tr>
                        {/*<th style={{ width: 60 }}>ID</th>*/}
                        <th>תפקיד</th>
                        <th style={{ width: 180 }}>פעולות</th>
                        </tr>
                    </thead>
                    <tbody>
                        {roles.map((r) => {
                        const isEditing = roleEditId === r.id;
                        return (
                        <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                            <td>
                                {isEditing ? (
                                    <input
                                        value={editRoleName}
                                        onChange={(e) => setEditRoleName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                saveEditRole(r.id);
                                            } else if (e.key === "Escape") {
                                                e.preventDefault();
                                                cancelEditRole();
                                            }
                                        }}
                                        style={{
                                            width: "100%",
                                            padding: "6px 10px",
                                            borderRadius: 6,
                                            border: "1px solid #1f2937",
                                            backgroundColor: "rgba(255,255,255,0.03)",
                                            color: "#e5e7eb",
                                            fontSize: 14,
                                        }}
                                        autoFocus
                                    />
                                ) : (
                                    r.name
                                )}
                            </td>
                            <td>
                                {isEditing ? (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button 
                                            type="button"
                                            onClick={() => saveEditRole(r.id)}
                                            title="שמור"
                                            style={{ 
                                                padding: "4px 8px",
                                                border: "none",
                                                background: "transparent",
                                                cursor: "pointer",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                color: "#e5e7eb"
                                            }}
                                        >
                                            <CheckIcon fontSize="small" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={cancelEditRole}
                                            title="בטל"
                                            style={{ 
                                                padding: "4px 8px",
                                                border: "none",
                                                background: "transparent",
                                                cursor: "pointer",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                color: "#e5e7eb"
                                            }}
                                        >
                                            <CloseIcon fontSize="small" />
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button 
                                            type="button"
                                            onClick={() => startEditRole(r.id, r.name)}
                                            title="ערוך"
                                            style={{ 
                                                padding: "4px 8px",
                                                border: "none",
                                                background: "transparent",
                                                cursor: "pointer",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                color: "#e5e7eb"
                                            }}
                                        >
                                            <EditIcon fontSize="small" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                showConfirmDeleteRole(r.id, r.name);
                                            }}
                                            title="מחק"
                                            style={{ 
                                                padding: "4px 8px",
                                                border: "none",
                                                background: "transparent",
                                                cursor: "pointer",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                color: "#e5e7eb"
                                            }}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </button>
                                    </div>
                                )}
                            </td>
                        </tr>
                        );
                        })}
                        {roles.length === 0 && (
                        <tr>
                            <td colSpan={4} style={{ opacity: 0.7 }}>(-)</td>
                        </tr>
                        )}
                    </tbody>
                    </table>

                </div>
            </Modal>

            {/* Vacations Modal */}
            <Modal
            open={vacDlg.isOpen}
            onClose={closeVacations}
            title={vacSoldier ? `חופשות — ${vacSoldier.name}` : "חופשות"}
            maxWidth={720}
            >
                {!vacSoldier ? (
                    <div style={{ opacity: 0.7 }}>לא נבחר חייל</div>
                ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                    {/* Toolbar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                            הוסף טווח תאריכים בהם החייל בחופשה
                        </div>
                    </div>

                    {/* Add/Edit form */}
                    <form onSubmit={saveVacation} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                        <div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>התחלה</div>
                        <input type="date" value={vacStart} onChange={(e) => setVacStart(e.target.value)} required />
                        </div>
                        <div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>סיום</div>
                        <input type="date" value={vacEnd} onChange={(e) => setVacEnd(e.target.value)} required />
                        </div>
                        <div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>הערות</div>
                        <input type="text" value={vacNote} onChange={(e) => setVacNote(e.target.value)} placeholder="הערות" />
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                        <button type="submit">{vacEditId == null ? "הוסף" : "שמור"}</button>
                        {vacEditId != null && (
                            <button
                            type="button"
                            onClick={() => {
                                setVacEditId(null);
                                setVacStart("");
                                setVacEnd("");
                                setVacNote("");
                            }}
                            >
                            בטל
                            </button>
                        )}
                        </div>
                    </form>

                    <Modal
                    open={restrDlg.isOpen}
                    onClose={closeRestrictions}
                    title={restrSoldier ? `Mission Restrictions — ${restrSoldier.name}` : "Mission Restrictions"}
                    maxWidth={720}
                    >
                    {!restrSoldier ? (
                        <div style={{ opacity: 0.7 }}>לא נבחר חייל</div>
                    ) : (
                        <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                            חיילים לא ישובצו למשימות שנבחרו
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {allMissions.map((m) => {
                            const selected = (restrCache[restrSoldier.id] || []).includes(m.id);
                            return (
                                <label key={m.id} className="inline-flex items-center gap-1 border rounded px-2 py-1">
                                <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={(e) => {
                                    const next = new Set(restrCache[restrSoldier.id] || []);
                                    if (e.target.checked) next.add(m.id); else next.delete(m.id);
                                    setRestrCache(prev => ({ ...prev, [restrSoldier.id]: Array.from(next) }));
                                    }}
                                />
                                <span>{m.name}</span>
                                </label>
                            );
                            })}
                        </div>

                        <div style={{ display: "flex", justifyContent: "end", gap: 8 }}>
                            <button onClick={closeRestrictions}>סגור</button>
                            <button
                            onClick={async () => {
                                try {
                                if (!restrSoldier) return;
                                setSavingRestr(restrSoldier.id);
                                await putSoldierMissionRestrictions(restrSoldier.id, restrCache[restrSoldier.id] || []);
                                } finally {
                                setSavingRestr(null);
                                }
                            }}
                            className="border rounded px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                            disabled={!!(restrSoldier && savingRestr === restrSoldier.id)}
                            >
                            {restrSoldier && savingRestr === restrSoldier.id ? "בשמירה..." : "שמור"}
                            </button>
                        </div>
                        </div>
                    )}
                    </Modal>

                    {/* Vacations list */}
                    <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
                        <thead>
                        <tr>
                            {/*<th style={{ width: 60 }}>ID</th>*/}
                            <th style={{ width: 140 }}>התחלה</th>
                            <th style={{ width: 140 }}>סיום</th>
                            <th>הערות</th>
                            <th style={{ width: 160 }}>פעולות</th>
                        </tr>
                        </thead>
                        <tbody>
                        {vacations.map((v) => (
                            <tr key={v.id} style={{ borderTop: "1px solid #eee" }}>
                            <td>{v.start_date}</td>
                            <td>{v.end_date}</td>
                            <td>{v.note ?? <span style={{ opacity: 0.6 }}>(אין)</span>}</td>
                            <td>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        deleteVacation(v);
                                    }}
                                    title="מחק"
                                    style={{ 
                                        padding: "4px 8px",
                                        border: "none",
                                        background: "transparent",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        color: "#e5e7eb"
                                    }}
                                >
                                    <DeleteIcon fontSize="small" />
                                </button>
                            </td>
                            </tr>
                        ))}
                        {vacations.length === 0 && (
                            <tr>
                            <td colSpan={5} style={{ opacity: 0.7 }}>(אין חופשות)</td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                    </div>
                )}
            </Modal>

            {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}
            {loading && <div>בטעינה...</div>}

            {/* Search Bar and Filters */}
            {!loading && (
                <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="חפש חייל..."
                        style={{
                            flex: "1 1 300px",
                            minWidth: 200,
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid #1f2937",
                            backgroundColor: "rgba(255,255,255,0.03)",
                            color: "#e5e7eb",
                            fontSize: 14,
                        }}
                    />
                    <select
                        value={filterRole}
                        onChange={(e) => setFilterRole(e.target.value)}
                        style={{
                            flex: "0 1 250px",
                            minWidth: 200,
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: "1px solid #1f2937",
                            backgroundColor: "rgba(255,255,255,0.03)",
                            color: "#e5e7eb",
                            fontSize: 14,
                            cursor: "pointer",
                            direction: "rtl",
                            textAlign: "right",
                        }}
                    >
                        <option value="" style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>כל התפקידים</option>
                        {Array.from(new Set(soldiers.flatMap(s => 
                            s.roles?.map(r => r.name) || []
                        ))).sort().map(role => (
                            <option key={role} value={role} style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>{role}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Grouped by Department (collapsible) */}
            {!loading && (
                <>
                    {!loading && departments.length === 0 && (
                    <div style={{ opacity: 0.7 }}>(אין מחלקות)</div>
                    )}

                    <div style={{ display: "grid", gap: 10 }}>
                    {sortedDepartments.map((dep) => {
                        const list = groupsByDeptId.get(dep.id) ?? [];
                        return (
                        <details
                            key={dep.id}
                            style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 12px" }}
                        >
                            <summary style={{ cursor: "pointer", userSelect: "none" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 600 }}>{dep.name}</span>
                                <span style={{ opacity: 0.7, fontSize: 12 }}>({list.length})</span>
                                </div>
                                <div
                                onClick={(e) => e.preventDefault()} // avoid toggling <details> via buttons
                                style={{ display: "flex", gap: 8, alignItems: "center" }}
                                >
                                <button 
                                    onClick={() => startEditDept(dep.id, dep.name)} 
                                    title="שנה שם מחלקה"
                                    style={{ 
                                        padding: "4px 8px",
                                        border: "none",
                                        background: "transparent",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        color: "#e5e7eb"
                                    }}
                                >
                                    <EditIcon fontSize="small" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        showConfirmDeleteDept(dep.id, dep.name);
                                    }}
                                    title="מחק מחלקה"
                                    style={{ 
                                        padding: "4px 8px",
                                        border: "none",
                                        background: "transparent",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        color: "#e5e7eb"
                                    }}
                                >
                                    <DeleteIcon fontSize="small" />
                                </button>
                                </div>
                            </div>
                            </summary>

                            <div style={{ marginTop: 8 }}>
                            {list.length === 0 ? (
                                <div style={{ border: "1px dashed #ddd", padding: 12, borderRadius: 8, opacity: 0.75 }}>
                                אין חיילים במחלקה
                                </div>
                            ) : (
                                <table width="100%" cellPadding={7} style={{ borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                    {/*<th style={{ width: 60 }}>ID</th>*/}
                                    <th style={{ minWidth: 150 }}>שם</th>
                                    <th style={{ width: 280 }}>תפקיד</th>
                                    <th style={{ width: 180 }}>מחלקה</th>
                                    <th style={{ width: 240 }}>הגבלות</th>
                                    <th style={{ width: 120 }}>חופשות</th>
                                    <th style={{ width: 120 }}>היסטוריה</th>
                                    <th style={{ width: 160 }}>פעולות</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.map((s) => {
                                    const isEditing = editId === s.id;
                                    return (
                                        <tr key={s.id} style={{ borderTop: "1px solid #eee" }}>
                                        {/*<td>{s.id}</td>*/}

                                        {/* name */}
                                        <td style={{ minWidth: 150 }}>
                                            {isEditing ? (
                                            <input
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                style={{ width: "100%", minWidth: 120, padding: "4px 8px" }}
                                            />
                                            ) : (
                                            s.name
                                            )}
                                        </td>

                                        {/* roles */}
                                        <td>
                                            {isEditing ? (
                                            <MultiSelectDropdown
                                                options={sortedRoles.map(r => r.id)}
                                                selected={editRoleIds}
                                                onChange={setEditRoleIds}
                                                placeholder="בחר תפקידים"
                                                getLabel={(id) => {
                                                    const role = sortedRoles.find(r => r.id === id);
                                                    return role?.name || String(id);
                                                }}
                                            />
                                            ) : s.roles?.length ? (
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                {s.roles.map((r) => (
                                                    <RolePill key={r.id} name={r.name} />
                                                ))}
                                            </div>
                                            ) : (
                                            <span style={{ opacity: 0.6 }}>(אין)</span>
                                            )}
                                        </td>

                                        {/* department (editable when editing) */}
                                        <td>
                                            {isEditing ? (
                                            <select
                                                value={(editDeptId || defaultDepartmentId) ?? ""}
                                                onChange={(e) => setEditDeptId(Number(e.target.value))}
                                                required
                                                disabled={departments.length === 0}
                                                style={{ 
                                                    width: "100%",
                                                    padding: "10px 12px",
                                                    borderRadius: 8,
                                                    border: "1px solid #1f2937",
                                                    backgroundColor: "rgba(255,255,255,0.03)",
                                                    color: "#e5e7eb",
                                                    fontSize: 14,
                                                    cursor: "pointer",
                                                    direction: "rtl",
                                                    textAlign: "right",
                                                }}
                                            >
                                                {departments.map((d) => (
                                                <option key={d.id} value={d.id} style={{ backgroundColor: "rgba(17, 24, 39, 0.95)", color: "#e5e7eb" }}>{d.name}</option>
                                                ))}
                                            </select>
                                            ) : (
                                            s.department_name ?? <span style={{ opacity: 0.6 }}>(אין)</span>
                                            )}
                                        </td>

                                        {/* restrictions */}
                                        <td>
                                            {isEditing ? (
                                            <MultiSelectDropdown
                                                options={restrictionOptions}
                                                selected={editRestrictions}
                                                onChange={setEditRestrictions}
                                                placeholder="בחר הגבלות"
                                                getLabel={(option) => option}
                                            />
                                            ) : s.restrictions_tokens && s.restrictions_tokens.length ? (
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                {s.restrictions_tokens.map((restriction, idx) => (
                                                    <RestrictionsPill key={idx} name={restriction} />
                                                ))}
                                            </div>
                                            ) : (
                                            <span style={{ opacity: 0.6 }}>(אין)</span>
                                            )}
                                        </td>

                                        {/* vacations */}
                                        <td>
                                            <button onClick={() => openVacations(s)}>חופשות</button>
                                        </td>
                                        <td>
                                            <button onClick={() => setHistoryFor({ id: s.id, name: s.name })}>
                                                היסטוריה
                                            </button>
                                        </td>
                                        {/* actions */}
                                        <td>
                                        {isEditing ? (
                                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <button 
                                                    onClick={() => saveEdit(s.id)}
                                                    title="שמור"
                                                    style={{ 
                                                        padding: "4px 8px",
                                                        border: "none",
                                                        background: "transparent",
                                                        cursor: "pointer",
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        color: "#e5e7eb"
                                                    }}
                                                >
                                                    <CheckIcon fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={cancelEdit}
                                                    title="בטל"
                                                    style={{ 
                                                        padding: "4px 8px",
                                                        border: "none",
                                                        background: "transparent",
                                                        cursor: "pointer",
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        color: "#e5e7eb"
                                                    }}
                                                >
                                                    <CloseIcon fontSize="small" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <button 
                                                    onClick={() => startEdit(s)}
                                                    title="ערוך"
                                                    style={{ 
                                                        padding: "4px 8px",
                                                        border: "none",
                                                        background: "transparent",
                                                        cursor: "pointer",
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        color: "#e5e7eb"
                                                    }}
                                                >
                                                    <EditIcon fontSize="small" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        showConfirmDeleteSoldier(s.id);
                                                    }}
                                                    title="מחק"
                                                    style={{ 
                                                        padding: "4px 8px",
                                                        border: "none",
                                                        background: "transparent",
                                                        cursor: "pointer",
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        color: "#e5e7eb"
                                                    }}
                                                >
                                                    <DeleteIcon fontSize="small" />
                                                </button>
                                            </div>
                                        )}
                                        </td>
                                        </tr>
                                    );
                                    })}
                                </tbody>
                                </table>
                            )}
                            </div>
                        </details>
                        );
                    })}
                    </div>

                    {/* Optional: Unassigned section */}
                    {unassigned.length > 0 && (
                    <details style={{ border: "1px solid #ddd", borderRadius: 10, padding: "8px 12px", marginTop: 10 }}>
                        <summary style={{ cursor: "pointer", userSelect: "none" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>לא משובץ</span>
                            <span style={{ opacity: 0.7, fontSize: 12 }}>({unassigned.length})</span>
                            </div>
                        </div>
                        </summary>
                        {/* reuse the same table markup, mapping over `unassigned` */}
                        {/* ... you can copy the table above and replace `list` with `unassigned` */}
                    </details>
                    )}

                    {historyFor && (
                    <SoldierHistoryModal
                        soldierId={historyFor.id}
                        soldierName={historyFor.name}
                        isOpen={true}
                        onClose={() => setHistoryFor(null)}
                    />
                    )}

                </>
            )}

            {/* Confirmation Modal */}
            <Modal 
                open={confirmDlg.isOpen} 
                onClose={() => {
                    setPendingDelete(null);
                    confirmDlg.close();
                }} 
                title="אישור מחיקה"
                maxWidth={480}
            >
                <div style={{ display: "grid", gap: 16 }}>
                    <p style={{ margin: 0, color: "#e5e7eb" }}>{confirmMessage}</p>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button 
                            type="button"
                            onClick={() => {
                                setPendingDelete(null);
                                confirmDlg.close();
                            }}
                            style={{
                                padding: "8px 16px",
                                border: "1px solid #1f2937",
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.03)",
                                color: "#e5e7eb",
                                cursor: "pointer",
                            }}
                        >
                            בטל
                        </button>
                        <button 
                            type="button"
                            onClick={executeDelete}
                            style={{
                                padding: "8px 16px",
                                border: "1px solid #dc2626",
                                borderRadius: 8,
                                background: "rgba(220, 38, 38, 0.1)",
                                color: "#f87171",
                                cursor: "pointer",
                            }}
                        >
                            מחק
                        </button>
                    </div>
                </div>
            </Modal>

        </div>
    );
}
