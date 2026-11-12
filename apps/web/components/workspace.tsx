"use client";
import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Building2,
  LayoutDashboard,
  FolderKanban,
  ClipboardList,
  Boxes,
  Truck,
  Warehouse,
  Hammer,
  Receipt,
  CheckSquare,
  BarChart3,
  Files,
  Users,
  Settings,
  Plus,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
  Menu,
  ArrowUpRight,
  Search,
  Download,
  Upload,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  CalendarClock,
  X,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Button, Modal } from "@pmt/ui";
import SiteEngineerDashboard from "./site-engineer-dashboard";
import AttendanceReport from "./attendance-report";
type Api = (
  path: string,
  method?: string,
  body?: any,
  key?: string,
) => Promise<any>;
type Option = { value: string; label: string };
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: Option[];
  required?: boolean;
  defaultValue?: string | number;
  hint?: string;
  step?: string;
};
type FormSpec = {
  title: string;
  path: string;
  fields: Field[];
  method?: string;
  build?: (v: any) => any;
  onSaved?: () => void;
};
const tabs = [
  "Overview",
  "Work Orders",
  "BOQ",
  "Procurement",
  "Supply",
  "Installation",
  "Billing",
  "Tasks",
  "Contacts",
  "Documents",
  "Activity",
  "Settings",
];
const date = (value: any) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const number = (v: any) =>
  v === null || v === undefined
    ? "—"
    : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 4 });
const status = (v: string) => (
  <span className={`badge status-${v.toLowerCase()}`}>
    {v.replaceAll("_", " ")}
  </span>
);
export default function Workspace({
  me,
  org,
  setOrg,
  api,
  onLogout,
}: {
  me: any;
  org: string;
  setOrg: (v: string) => void;
  api: Api;
  onLogout: () => void;
}) {
  const [view, setView] = useState("Dashboard"),
    [projectId, setProjectId] = useState(""),
    [tab, setTab] = useState("Overview"),
    [projects, setProjects] = useState<any[]>([]),
    [payload, setPayload] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [materials, setMaterials] = useState<any[]>([]),
    [_clients, setClients] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [form, setForm] = useState<FormSpec | null>(null),
    [importOpen, setImportOpen] = useState(false),
    [dark, setDark] = useState(false),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [taskMode, setTaskMode] = useState("List"),
    [myTaskPage, setMyTaskPage] = useState(1),
    [myTaskState, setMyTaskState] = useState("open");
  const membership = me.memberships.find((m: any) => m.orgId === org),
    can = (p: string) => membership?.role.permissions.includes(p);
  const siteEngineer = membership?.role.name === "SITE_ENGINEER";
  const currency = membership?.organization.currency || "INR";
  const money = (v: any) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(v || 0));
  const projectViews = [
    "Work Orders",
    "Procurement",
    "Inventory",
    "Installation",
    "Billing",
    "Tasks",
    "Reports",
    "Documents",
  ];
  const scoped =
    (view === "Projects" && !!projectId) || projectViews.includes(view);
  const activeTab =
    view === "Projects"
      ? tab
      : (
          { Inventory: "Supply", Reports: "Overview" } as Record<string, string>
        )[view] || view;
  const dataKey = `${org}:${view}:${projectId}:${activeTab}`;
  const data = payload?.key === dataKey ? payload.value : null;
  const setData = (value: any) => setPayload({ key: dataKey, value });
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      if (
        (view === "Dashboard" && siteEngineer) ||
        view === "Attendance reports"
      )
        return;
      const list = await api("projects");
      setProjects(list.rows);
      if (view === "Dashboard") setData(await api("dashboard"));
      else if (view === "Projects" && !projectId) setData(list.rows);
      else if (view === "Materials") {
        setData(await api("materials"));
      } else if (view === "My work") {
        setData(
          await api(
            `workspace/my-tasks?page=${myTaskPage}&state=${myTaskState}`,
          ),
        );
      } else if (view === "Account security") {
        setData(await api("auth/sessions"));
      } else if (view === "Team") {
        setData(await api("organizations/roles"));
      } else if (view === "Settings") {
        setData(await api("organizations/roles"));
      } else if (projectId) {
        const [p, m, c] = await Promise.all([
          api(`projects/${projectId}`),
          api("materials"),
          api("clients"),
        ]);
        setDetail(p);
        setMaterials(m);
        setClients(c);
        const endpoint: Record<string, string> = {
          Overview: "balances",
          BOQ: "balances",
          Supply: "movements",
          Installation: "installations",
          Billing: "invoices",
          Tasks: "tasks",
          Documents: "documents",
          Activity: "activity",
          Procurement: "purchase-orders",
        };
        setData(
          endpoint[activeTab]
            ? await api(`projects/${projectId}/${endpoint[activeTab]}`)
            : null,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, view, projectId, activeTab, myTaskPage, myTaskState, siteEngineer]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    setProjectId("");
    setDetail(null);
    setForm(null);
    setMyTaskPage(1);
  }, [org]);
  const [teamPage, setTeamPage] = useState(1);
  const [teamMemberPage, setTeamMemberPage] = useState(1);
  const [selectedTeam, setSelectedTeam] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [teams, setTeams] = useState<{ rows: any[]; total: number } | null>(
    null,
  );
  const [teamMembers, setTeamMembers] = useState<{
    rows: any[];
    total: number;
  } | null>(null);
  useEffect(() => {
    if (view !== "Team" || !data) return;
    let current = true;
    void Promise.all([
      api(`organizations/teams?page=${teamPage}`),
      selectedTeam
        ? api(
            `organizations/teams/${selectedTeam.id}/members?page=${teamMemberPage}`,
          )
        : Promise.resolve(null),
    ])
      .then(([groups, members]) => {
        if (current) {
          setTeams(groups);
          setTeamMembers(members);
        }
      })
      .catch((error: Error) => {
        if (current) setError(error.message);
      });
    return () => {
      current = false;
    };
  }, [api, data, selectedTeam, teamMemberPage, teamPage, view]);
  useEffect(() => {
    setSelectedTeam(null);
    setTeams(null);
    setTeamMembers(null);
    setTeamPage(1);
    setTeamMemberPage(1);
  }, [org]);
  const [staffSearch, setStaffSearch] = useState("");
  const [staffAccess, setStaffAccess] = useState("all");
  const [staffSort, setStaffSort] = useState("name");
  const [staffPage, setStaffPage] = useState(1);
  const [invitationPage, setInvitationPage] = useState(1);
  const [directory, setDirectory] = useState<{
    rows: any[];
    total: number;
  } | null>(null);
  const [invitations, setInvitations] = useState<{
    rows: any[];
    total: number;
  } | null>(null);
  useEffect(() => {
    if (view !== "Team" || !data) return;
    let current = true;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        search: staffSearch,
        access: staffAccess,
        sort: staffSort,
        page: String(staffPage),
      });
      void Promise.all([
        api(`organizations/staff?${query}`),
        api(`organizations/invitations?page=${invitationPage}`),
      ])
        .then(([staff, invites]) => {
          if (current) {
            setDirectory(staff);
            setInvitations(invites);
          }
        })
        .catch((error: Error) => {
          if (current) setError(error.message);
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    api,
    data,
    invitationPage,
    staffAccess,
    staffPage,
    staffSearch,
    staffSort,
    view,
  ]);
  useEffect(() => {
    setDirectory(null);
    setInvitations(null);
    setStaffPage(1);
    setInvitationPage(1);
  }, [org]);
  function navigate(name: string) {
    setData(null);
    setView(name);
    setSearch("");
    setMobile(false);
    if (name === "Projects") setProjectId("");
  }
  async function openProject() {
    const c = await api("clients");
    setClients(c);
    setForm({
      title: "Create a project",
      path: "projects",
      fields: [
        { name: "name", label: "Project name" },
        { name: "code", label: "Project code" },
        {
          name: "clientId",
          label: "Client",
          options: c.map((r: any) => ({ value: r.id, label: r.name })),
        },
        { name: "city", label: "City" },
        { name: "state", label: "State", required: false },
        { name: "manager", label: "Project manager", required: false },
        {
          name: "startDate",
          label: "Start date",
          type: "date",
          required: false,
        },
        {
          name: "targetDate",
          label: "Target completion",
          type: "date",
          required: false,
        },
        {
          name: "budget",
          label: "Budget",
          type: "number",
          defaultValue: "0",
          step: "0.01",
        },
        {
          name: "contractValue",
          label: "Contract value",
          type: "number",
          defaultValue: "0",
          step: "0.01",
        },
      ],
    });
  }
  function projectPath(path: string) {
    return `projects/${projectId}/${path}`;
  }
  const boq =
    detail?.workOrders.flatMap((wo: any) =>
      wo.items.map((i: any) => ({ ...i, workOrderNumber: wo.number })),
    ) || [];
  const itemOptions = boq.map((i: any) => ({
    value: i.id,
    label: `${i.material.name} · ${i.workOrderNumber}`,
  }));
  function stockForm(kind = "receipts") {
    setForm({
      title: kind === "returns" ? "Return stock" : "Record accepted receipt",
      path: projectPath(kind),
      fields: [
        {
          name: "boqItemId",
          label: "Material / BOQ item",
          options: itemOptions,
        },
        { name: "quantity", label: "Quantity", type: "number", step: "0.0001" },
        {
          name: "reference",
          label:
            kind === "returns"
              ? "Return reference"
              : "Delivery / challan reference",
        },
        {
          name: kind === "returns" ? "reason" : "notes",
          label: kind === "returns" ? "Reason for return" : "Receipt notes",
          required: kind === "returns",
        },
      ],
    });
  }
  function installForm() {
    setForm({
      title: "New installation report",
      path: projectPath("installations"),
      fields: [
        { name: "boqItemId", label: "Material", options: itemOptions },
        {
          name: "quantity",
          label: "Installed quantity",
          type: "number",
          step: "0.0001",
        },
        { name: "area", label: "Floor / zone / area" },
        { name: "reportDate", label: "Progress date", type: "date" },
        { name: "notes", label: "Site notes", required: false },
      ],
    });
  }
  function transition(row: any, next: string) {
    setForm({
      title: `${next.charAt(0) + next.slice(1).toLowerCase()} installation`,
      path: projectPath(`installations/${row.id}/transition`),
      fields: ["REJECTED", "REVERSED"].includes(next)
        ? [{ name: "reason", label: "Reason (at least 5 characters)" }]
        : [],
      build: (v) => ({ ...v, status: next, version: row.version }),
    });
  }
  function invoiceForm() {
    setForm({
      title: "Draft an invoice",
      path: projectPath("invoices"),
      fields: [
        { name: "number", label: "Invoice number" },
        {
          name: "kind",
          label: "Billing type",
          options: [
            { value: "SUPPLY", label: "Supply" },
            { value: "INSTALLATION", label: "Installation" },
          ],
        },
        { name: "boqItemId", label: "Eligible material", options: itemOptions },
        { name: "quantity", label: "Quantity", type: "number", step: "0.0001" },
        { name: "dueDate", label: "Payment due date", type: "date" },
        {
          name: "retentionPercent",
          label: "Retention %",
          type: "number",
          step: "0.01",
          defaultValue: "0",
        },
      ],
      build: ({ boqItemId, quantity, ...v }) => ({
        ...v,
        lines: [{ boqItemId, quantity }],
      }),
    });
  }
  function paymentForm(row: any) {
    setForm({
      title: `Record payment · ${row.number}`,
      path: projectPath("payments"),
      fields: [
        {
          name: "amount",
          label: `Amount received (outstanding ${money(row.outstanding)})`,
          type: "number",
          step: "0.01",
        },
        { name: "reference", label: "Bank / payment reference" },
        { name: "receivedAt", label: "Received date", type: "date" },
      ],
      build: (v) => ({
        ...v,
        allocations: [{ invoiceId: row.id, amount: v.amount }],
      }),
    });
  }
  const managesTasks = can("task.manage") && can("project.edit");
  function taskStatus(task: any, id: string) {
    const ownOpenTask =
      can("task.manage") &&
      task.assigneeId === me.user.id &&
      !["DONE", "IN_REVIEW"].includes(task.status);
    if (!managesTasks && !ownOpenTask) return status(task.status);
    const options = new Set<string>([task.status]);
    if (task.status === "IN_REVIEW") {
      options.add("DONE");
      options.add("CHANGES_REQUESTED");
    } else {
      ["TODO", "IN_PROGRESS", "BLOCKED"].forEach((state) => options.add(state));
      if (["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status))
        options.add("IN_REVIEW");
      if (managesTasks) options.add("DONE");
    }
    const labels: Record<string, string> = {
      TODO: "To do",
      IN_PROGRESS: "In progress",
      BLOCKED: "Blocked",
      IN_REVIEW:
        task.status === "IN_REVIEW" ? "In review" : "Submit for review",
      CHANGES_REQUESTED:
        task.status === "IN_REVIEW" ? "Request changes" : "Changes requested",
      DONE: task.status === "IN_REVIEW" ? "Approve completion" : "Done",
    };
    return (
      <select
        aria-label={`Status for ${task.title}`}
        value={task.status}
        onChange={(e) =>
          void mutate(
            `projects/${id}/tasks/${task.id}`,
            { version: task.version, status: e.target.value },
            "PATCH",
          )
        }
      >
        {[...options].map((state) => (
          <option key={state} value={state}>
            {labels[state]}
          </option>
        ))}
      </select>
    );
  }
  function taskForm(task?: any) {
    setForm({
      title: task ? "Edit task" : "Create task",
      path: projectPath(task ? `tasks/${task.id}` : "tasks"),
      method: task ? "PATCH" : "POST",
      build: task
        ? (values) => ({
            ...values,
            version: task.version,
            dueDate: values.dueDate || null,
            assigneeId: values.assigneeId || null,
            description: values.description || "",
          })
        : undefined,
      fields: [
        { name: "title", label: "Task title", defaultValue: task?.title },
        {
          name: "description",
          label: "Description",
          required: false,
          defaultValue: task?.description,
        },
        {
          name: "priority",
          label: "Priority",
          defaultValue: task?.priority || "MEDIUM",
          options: ["LOW", "MEDIUM", "HIGH", "URGENT"].map((v) => ({
            value: v,
            label: v,
          })),
        },
        {
          name: "dueDate",
          label: "Due date",
          type: "date",
          required: false,
          defaultValue: task?.dueDate?.slice(0, 10),
        },
        ...(can("project.edit")
          ? [
              {
                name: "assigneeId",
                label: "Assignee",
                required: false,
                defaultValue: task?.assigneeId || "",
                options: detail?.members
                  .filter(
                    ({ membership }: any) =>
                      membership.active &&
                      membership.role.permissions.includes("project.view"),
                  )
                  .map(({ membership }: any) => ({
                    value: membership.user.id,
                    label: membership.user.name,
                  })),
              },
            ]
          : []),
      ],
    });
  }
  async function mutate(path: string, body: any = {}, method = "POST") {
    setError("");
    try {
      await api(path, method, body, crypto.randomUUID());
      setSuccess("Changes saved.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function downloadReport(pdf = false) {
    setError("");
    try {
      const response = await fetch(
        `/api/v1/${projectPath(pdf ? "export.pdf" : "export")}`,
        {
          headers: { "x-organization-id": org },
        },
      );
      if (!response.ok) throw new Error("Report export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `project-${detail?.code || "report"}.${pdf ? "pdf" : "xlsx"}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const nav = [
    ["Dashboard", LayoutDashboard],
    ["My work", CheckSquare],
    ["Projects", FolderKanban],
    ["Work Orders", ClipboardList],
    ["Materials", Boxes],
    ["Procurement", Truck],
    ["Inventory", Warehouse],
    ["Installation", Hammer],
    ["Billing", Receipt],
    ["Tasks", CheckSquare],
    ["Reports", BarChart3],
    ["Attendance reports", CalendarClock],
    ["Documents", Files],
    ["Team", Users],
    ["Settings", Settings],
    ["Account security", ShieldCheck],
  ] as const;
  const filtered = Array.isArray(data)
    ? data.filter((row: any) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      )
    : [];
  const open = (p: { id: string }, nextTab = "Overview") => {
    setProjectId(p.id);
    setView("Projects");
    setTab(nextTab);
  };
  const field = (name: string, label: string, type?: string): Field => ({
    name,
    label,
    type,
  });
  async function onboardingForm(direct: boolean) {
    try {
      const roles = await api("organizations/roles");
      setForm({
        title: direct ? "Create staff account" : "Invite team member",
        path: direct ? "organizations/staff" : "organizations/invitations",
        fields: [
          ...(direct ? [field("name", "Full name")] : []),
          field("email", "Email address", "email"),
          {
            name: "roleId",
            label: "Role",
            options: roles
              .filter((role: { permissions: string[] }) =>
                role.permissions.every((permission) => can(permission)),
              )
              .map((role: { id: string; name: string }) => ({
                value: role.id,
                label: role.name.replaceAll("_", " "),
              })),
          },
          ...(direct
            ? [
                {
                  name: "password",
                  label: "Initial password",
                  type: "password",
                  hint: "Use at least 12 characters. The staff member can sign in as soon as you save.",
                },
              ]
            : []),
        ],
      });
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function teamForm(team?: { id: string; name: string; description: string }) {
    setForm({
      title: team ? "Edit team" : "Create team",
      path: team ? `organizations/teams/${team.id}` : "organizations/teams",
      method: team ? "PATCH" : "POST",
      fields: [
        { name: "name", label: "Team name", defaultValue: team?.name },
        {
          name: "description",
          label: "Description",
          required: false,
          defaultValue: team?.description,
        },
      ],
      onSaved:
        team && selectedTeam?.id === team.id
          ? () => setSelectedTeam(null)
          : undefined,
    });
  }
  return (
    <div className={`portal ${dark ? "dark" : ""}`}>
      <aside className={mobile ? "sidebar mobile-open" : "sidebar"}>
        <div className="brand">
          <span className="brand-mark">
            <Building2 size={21} />
          </span>
          fieldwork<span className="brand-dot">.</span>
        </div>
        <div className="workspace">
          <span className="workspace-icon">
            {membership?.organization.name.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <b>{membership?.organization.name}</b>
            <small>Operations workspace</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav
            .filter(([n]) =>
              n === "Attendance reports"
                ? can("organization.manage")
                : n === "My work"
                  ? can("project.view")
                  : !["Team", "Settings"].includes(n) || can("team.manage"),
            )
            .map(([name, Icon]) => (
              <button
                key={name}
                className={view === name ? "active" : ""}
                onClick={() => navigate(name)}
              >
                <Icon size={17} />
                {name}
                {view === name && <span className="nav-indicator" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-note">
            <ShieldCheck size={19} />
            <div>
              <b>Every detail accounted for.</b>
              <p>Connected. Controlled. Traceable.</p>
            </div>
          </div>
          <button className="profile" onClick={onLogout}>
            <span className="avatar">
              {me.user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <b>{me.user.name}</b>
              <small>{membership?.role.name.replaceAll("_", " ")}</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <b>{view}</b>
            {scoped && projectId && (
              <>
                <span>/</span>
                {detail?.code}
              </>
            )}
          </div>
          <div className="top-actions">
            <select
              aria-label="Organization"
              value={org}
              onChange={(e) => {
                const nextOrg = e.target.value;
                if (
                  view === "Attendance reports" &&
                  !me.memberships.some(
                    (member: typeof membership) =>
                      member.orgId === nextOrg &&
                      member.role.permissions.includes("organization.manage"),
                  )
                )
                  navigate("Dashboard");
                setOrg(nextOrg);
              }}
            >
              {me.memberships.map((m: any) => (
                <option value={m.orgId} key={m.orgId}>
                  {m.organization.name}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Toggle theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="avatar small">
              {me.user.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">OPERATIONS / {view.toUpperCase()}</div>
              <h1>
                {scoped && detail
                  ? detail.name
                  : view === "Dashboard"
                    ? siteEngineer
                      ? "Site engineer dashboard"
                      : "Project dashboard"
                    : view}
              </h1>
              <p className="muted">
                {view === "Dashboard"
                  ? siteEngineer
                    ? "Punch in at the site, upload project photos and videos, then punch out when you finish."
                    : "Review project details, resolve outstanding work, and see what’s due next."
                  : scoped && detail
                    ? `${detail.code} · ${detail.city} · ${detail.client.name}`
                    : (
                        {
                          Projects: "From first delivery to final milestone.",
                          Materials:
                            "A single source of truth for every material.",
                          Team: "The people keeping your projects moving.",
                          Settings: "Your organization. Your access policies.",
                        } as any
                      )[view]}
              </p>
            </div>
            <div className="heading-actions">
              {view === "Projects" && !projectId && can("project.create") && (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setForm({
                        title: "Create client",
                        path: "clients",
                        fields: [
                          field("name", "Client name"),
                          {
                            ...field("email", "Email", "email"),
                            required: false,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Client
                  </Button>
                  <Button
                    onClick={() =>
                      void openProject().catch((e) => setError(e.message))
                    }
                  >
                    <Plus size={15} />
                    New project
                  </Button>
                </>
              )}
              {view === "Materials" && can("material.manage") && (
                <Button
                  onClick={() =>
                    setForm({
                      title: "Add material",
                      path: "materials",
                      fields: [
                        field("sku", "SKU / code"),
                        field("name", "Material name"),
                        {
                          ...field("category", "Category"),
                          defaultValue: "General",
                        },
                        {
                          ...field("uom", "Unit of measurement"),
                          defaultValue: "Nos",
                        },
                        {
                          ...field(
                            "precision",
                            "Measurement decimal places",
                            "number",
                          ),
                          defaultValue: 0,
                        },
                        {
                          ...field(
                            "standardRate",
                            "Standard supply rate",
                            "number",
                          ),
                          step: "0.01",
                          defaultValue: "0",
                        },
                      ],
                      build: (v) => ({ ...v, precision: Number(v.precision) }),
                    })
                  }
                >
                  <Plus size={15} />
                  Add material
                </Button>
              )}
              {view === "Team" && can("team.manage") && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void onboardingForm(false)}
                  >
                    Invite member
                  </Button>
                  {can("organization.manage") && (
                    <Button onClick={() => void onboardingForm(true)}>
                      <Plus size={15} />
                      Add staff
                    </Button>
                  )}
                </>
              )}
              {scoped && projectId && can("report.export") && (
                <Button variant="outline" onClick={() => void downloadReport()}>
                  <Download size={15} />
                  Excel
                </Button>
              )}
              {scoped && projectId && can("report.export") && (
                <Button
                  variant="outline"
                  onClick={() => void downloadReport(true)}
                >
                  <Download size={15} /> PDF
                </Button>
              )}
            </div>
          </div>
          {error && (
            <div className="notice" role="alert">
              <AlertCircle size={16} />
              {error}
              <button onClick={() => void reload()}>Retry</button>
            </div>
          )}
          {success && (
            <div className="success-notice" role="status">
              <CheckCircle2 size={16} />
              {success}
              <button
                aria-label="Dismiss notification"
                onClick={() => setSuccess("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {projectViews.includes(view) && (
            <div className="context-selector">
              <label>
                PROJECT
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">Select a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {view === "Projects" && projectId && (
            <>
              <button
                className="text-button back"
                onClick={() => {
                  setProjectId("");
                  setDetail(null);
                }}
              >
                <ArrowLeft size={14} />
                All projects
              </button>
              <div className="tabs">
                {tabs.map((t) => (
                  <button
                    key={t}
                    className={t === tab ? "selected" : ""}
                    onClick={() => {
                      setTab(t);
                      setSearch("");
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          )}
          {loading ? (
            <div className="empty">
              <Loader2 className="spin" size={20} />
              Loading your workspace…
            </div>
          ) : error ? (
            <div className="empty">
              Data could not be loaded. Use Retry above.
            </div>
          ) : view === "Attendance reports" && can("organization.manage") ? (
            <AttendanceReport
              key={org}
              api={api}
              onOpenDocuments={(id) => open({ id }, "Documents")}
            />
          ) : view === "Dashboard" && siteEngineer ? (
            <SiteEngineerDashboard
              key={org}
              api={api}
              canUpload={can("document.manage")}
              onOpenDocuments={(id) => open({ id }, "Documents")}
            />
          ) : view === "Dashboard" && data ? (
            <>
              <DashboardProjects
                projects={data.projects}
                today={data.today}
                money={money}
                onOpen={open}
              />
              <div className="section-heading">
                <h2>Portfolio overview</h2>
              </div>
              <div className="metric-grid">
                <Metric
                  label="TOTAL PROJECTS"
                  value={data.totalProjects}
                  note={`${data.activeProjects} active · ${data.delayedProjects} delayed`}
                  icon={<FolderKanban size={18} />}
                />
                <Metric
                  label="APPROVED SUPPLY ORDER VALUE"
                  value={money(data.orderValue)}
                  note="Current approved work orders"
                  icon={<ClipboardList size={18} />}
                />
                <Metric
                  label="INVOICED VALUE"
                  value={money(data.invoiced)}
                  note={`${money(data.unbilled)} eligible, unbilled`}
                  icon={<Receipt size={18} />}
                />
                <Metric
                  label="OUTSTANDING"
                  value={money(data.outstanding)}
                  note={`${money(data.overdue)} overdue`}
                  icon={<BarChart3 size={18} />}
                />
              </div>
              <div className="dashboard-delivery">
                <section className="card">
                  <div className="section-heading">
                    <h2>Delivery at a glance</h2>
                    <span className="muted">Value-weighted progress</span>
                  </div>
                  <div className="progress-pair">
                    <Progress
                      label="Material supply"
                      value={data.supplyProgress}
                    />
                    <Progress
                      label="Installation"
                      value={data.installationProgress}
                    />
                  </div>
                  {data.materials.length ? (
                    <div style={{ height: 190, width: "100%" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.materials.slice(0, 8).map((r: any) => ({
                            name:
                              r.material.length > 18
                                ? r.material.slice(0, 18) + "…"
                                : r.material,
                            supplied:
                              (Number(r.supplied) / Number(r.ordered)) * 100,
                            installed:
                              (Number(r.installed) / Number(r.ordered)) * 100,
                          }))}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e7ece6"
                          />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                            unit="%"
                          />
                          <Tooltip />
                          <Bar
                            isAnimationActive={false}
                            dataKey="supplied"
                            name="Supplied %"
                            fill="#416e4f"
                            radius={[3, 3, 0, 0]}
                          />
                          <Bar
                            isAnimationActive={false}
                            dataKey="installed"
                            name="Installed %"
                            fill="#b6ce90"
                            radius={[3, 3, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty
                      title="Your progress starts with a project"
                      text="Create a client and project, then add an approved work order."
                      action={
                        can("project.create") ? (
                          <Button
                            variant="outline"
                            onClick={() => navigate("Projects")}
                          >
                            Go to projects
                            <ArrowRight size={14} />
                          </Button>
                        ) : undefined
                      }
                    />
                  )}
                </section>
              </div>
            </>
          ) : view === "Projects" && !projectId ? (
            <>
              <div className="list-toolbar">
                <SearchBox value={search} onChange={setSearch} />
                <span className="muted">{projects.length} projects loaded</span>
              </div>
              <ProjectCards projects={filtered} onOpen={open} />
              {!filtered.length && (
                <Empty
                  title="No projects yet"
                  text="Create a client, then create your first project."
                />
              )}
            </>
          ) : view === "Materials" ? (
            <>
              <SearchBox value={search} onChange={setSearch} />
              <DataTable
                rows={filtered}
                columns={[
                  col("sku", "SKU"),
                  col("name", "Material"),
                  col("category", "Category"),
                  col("uom", "UOM"),
                  col("precision", "Precision"),
                  col("standardRate", "Standard rate", (v) => money(v)),
                ]}
              />
            </>
          ) : view === "My work" ? (
            <>
              <div className="section-heading">
                <h2>My assigned tasks</h2>
                <select
                  aria-label="Task filter"
                  value={myTaskState}
                  onChange={(e) => {
                    setMyTaskState(e.target.value);
                    setMyTaskPage(1);
                  }}
                >
                  <option value="open">Open tasks</option>
                  <option value="completed">Completed tasks</option>
                  <option value="all">All assigned tasks</option>
                </select>
              </div>
              <DataTable
                rows={data?.rows ?? []}
                columns={[
                  col("title", "Task"),
                  {
                    header: "Project",
                    cell: ({ row }) => (
                      <button
                        className="text-button"
                        onClick={() => open(row.original.project, "Tasks")}
                      >
                        {row.original.project.name}
                      </button>
                    ),
                  },
                  col("priority", "Priority", status),
                  col("dueDate", "Due date", date),
                  {
                    header: "Status",
                    cell: ({ row }) =>
                      taskStatus(row.original, row.original.projectId),
                  },
                ]}
              />
              <TeamPagination
                page={myTaskPage}
                total={data?.total ?? 0}
                onPage={setMyTaskPage}
              />
            </>
          ) : view === "Account security" ? (
            <>
              <div className="section-heading">
                <h2>Active sessions</h2>
                <div className="heading-actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setForm({
                        title: "Change password and sign out",
                        path: "auth/change-password",
                        fields: [
                          field(
                            "currentPassword",
                            "Current password",
                            "password",
                          ),
                          field("newPassword", "New password", "password"),
                        ],
                        onSaved: () => window.location.reload(),
                      })
                    }
                  >
                    Change password
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setForm({
                        title: "Sign out of all devices?",
                        path: "auth/revoke-all",
                        fields: [],
                        onSaved: () => window.location.reload(),
                      })
                    }
                  >
                    Sign out everywhere
                  </Button>
                </div>
              </div>
              <DataTable
                rows={data ?? []}
                columns={[
                  {
                    header: "Session",
                    cell: ({ row }) =>
                      row.original.current ? "This session" : "Other session",
                  },
                  {
                    header: "Signed in",
                    cell: ({ row }) =>
                      new Date(row.original.createdAt).toLocaleString(),
                  },
                  {
                    header: "Expires",
                    cell: ({ row }) =>
                      new Date(row.original.expiresAt).toLocaleString(),
                  },
                  {
                    header: "Manage",
                    cell: ({ row }) => (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setForm({
                            title: "End this session?",
                            path: `auth/sessions/${row.original.id}`,
                            method: "DELETE",
                            fields: [],
                            onSaved: row.original.current
                              ? () => window.location.reload()
                              : undefined,
                          })
                        }
                      >
                        End session
                      </Button>
                    ),
                  },
                ]}
              />
            </>
          ) : view === "Team" ? (
            <>
              <div className="section-heading">
                <h2>Staff directory</h2>
              </div>
              <div className="list-toolbar">
                <SearchBox
                  value={staffSearch}
                  onChange={(value) => {
                    setStaffSearch(value);
                    setStaffPage(1);
                  }}
                />
                <select
                  aria-label="Staff access"
                  value={staffAccess}
                  onChange={(event) => {
                    setStaffAccess(event.target.value);
                    setStaffPage(1);
                  }}
                >
                  <option value="all">All access states</option>
                  <option value="active">Active</option>
                  <option value="inactive">Revoked</option>
                </select>
                <select
                  aria-label="Staff sorting"
                  value={staffSort}
                  onChange={(event) => {
                    setStaffSort(event.target.value);
                    setStaffPage(1);
                  }}
                >
                  <option value="name">Name</option>
                  <option value="newest">Newest first</option>
                </select>
              </div>
              <DataTable
                rows={directory?.rows ?? []}
                columns={[
                  { header: "Team member", accessorFn: (r) => r.user.name },
                  { header: "Email", accessorFn: (r) => r.user.email },
                  {
                    header: "Role",
                    cell: ({ row }) => status(row.original.role.name),
                  },
                  {
                    header: "Access",
                    cell: ({ row }) =>
                      row.original.active ? "Active" : "Revoked",
                  },
                  {
                    header: "Projects",
                    accessorFn: (r) => r._count.projectAccess,
                  },
                  {
                    header: "Manage",
                    cell: ({ row }) =>
                      row.original.role.permissions.every(
                        (permission: string) => can(permission),
                      ) ? (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              const roles = data ?? [];
                              setForm({
                                title: `Manage ${row.original.user.name}`,
                                path: `organizations/members/${row.original.id}`,
                                method: "PATCH",
                                fields: [
                                  {
                                    name: "roleId",
                                    label: "Role",
                                    defaultValue: row.original.roleId,
                                    options: roles.map((r: any) => ({
                                      value: r.id,
                                      label: r.name.replaceAll("_", " "),
                                    })),
                                  },
                                  {
                                    name: "active",
                                    label: "Membership access",
                                    defaultValue: String(row.original.active),
                                    options: [
                                      { value: "true", label: "Active" },
                                      { value: "false", label: "Revoked" },
                                    ],
                                  },
                                ],
                                build: (v) => ({
                                  ...v,
                                  active: v.active === "true",
                                }),
                              });
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Manage access
                        </Button>
                      ) : null,
                  },
                ]}
              />
              <TeamPagination
                page={staffPage}
                total={directory?.total ?? 0}
                onPage={setStaffPage}
              />
              <div className="section-heading">
                <h2>Teams</h2>
                <Button variant="outline" onClick={() => teamForm()}>
                  <Plus size={14} /> Create team
                </Button>
              </div>
              <DataTable
                rows={teams?.rows ?? []}
                columns={[
                  col("name", "Team"),
                  col("description", "Description"),
                  {
                    header: "Members",
                    accessorFn: (row) => row._count.members,
                  },
                  {
                    header: "Manage",
                    cell: ({ row }) => {
                      const team = row.original;
                      return (
                        <div className="heading-actions">
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (selectedTeam?.id === team.id) return;
                              setSelectedTeam(team);
                              setTeamMembers(null);
                              setTeamMemberPage(1);
                            }}
                          >
                            Manage members
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => teamForm(team)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setForm({
                                title: `Delete ${team.name}?`,
                                path: `organizations/teams/${team.id}`,
                                method: "DELETE",
                                fields: [],
                                onSaved: () => {
                                  if (selectedTeam?.id === team.id)
                                    setSelectedTeam(null);
                                  setTeamPage(1);
                                },
                              })
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      );
                    },
                  },
                ]}
              />
              <TeamPagination
                page={teamPage}
                total={teams?.total ?? 0}
                onPage={setTeamPage}
              />
              {selectedTeam && (
                <section aria-label="Team members">
                  <div className="section-heading">
                    <h2>{selectedTeam.name} members</h2>
                    <div className="heading-actions">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setForm({
                            title: `Add an active member to ${selectedTeam.name}`,
                            path: `organizations/teams/${selectedTeam.id}/members`,
                            fields: [field("email", "Staff email", "email")],
                            onSaved: () => setTeamMemberPage(1),
                          })
                        }
                      >
                        Add member
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setSelectedTeam(null)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                  <DataTable
                    rows={teamMembers?.rows ?? []}
                    columns={[
                      {
                        header: "Member",
                        accessorFn: (row) => row.membership.user.name,
                      },
                      {
                        header: "Email",
                        accessorFn: (row) => row.membership.user.email,
                      },
                      {
                        header: "Access",
                        cell: ({ row }) =>
                          row.original.membership.active ? "Active" : "Revoked",
                      },
                      {
                        header: "Manage",
                        cell: ({ row }) => (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setForm({
                                title: `Remove ${row.original.membership.user.name} from ${selectedTeam.name}?`,
                                path: `organizations/teams/${selectedTeam.id}/members/${row.original.membershipId}`,
                                method: "DELETE",
                                fields: [],
                                onSaved: () => setTeamMemberPage(1),
                              })
                            }
                          >
                            Remove from team
                          </Button>
                        ),
                      },
                    ]}
                  />
                  <TeamPagination
                    page={teamMemberPage}
                    total={teamMembers?.total ?? 0}
                    onPage={setTeamMemberPage}
                  />
                </section>
              )}
              <div className="section-heading">
                <h2>Invitations</h2>
              </div>
              <DataTable
                rows={invitations?.rows ?? []}
                columns={[
                  col("email", "Email"),
                  {
                    header: "Role",
                    cell: ({ row }) => status(row.original.role),
                  },
                  {
                    header: "Expires",
                    cell: ({ row }) => date(row.original.expiresAt),
                  },
                  {
                    header: "Status",
                    cell: ({ row }) =>
                      row.original.acceptedAt
                        ? "Accepted"
                        : row.original.revokedAt
                          ? "Revoked"
                          : new Date(row.original.expiresAt) <= new Date()
                            ? "Expired"
                            : "Pending",
                  },
                  {
                    header: "Manage",
                    cell: ({ row }) => {
                      const invitation = row.original;
                      if (
                        !invitation.canManage ||
                        invitation.acceptedAt ||
                        invitation.revokedAt
                      )
                        return null;
                      return (
                        <div className="heading-actions">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setForm({
                                title: `Resend invitation to ${invitation.email}?`,
                                path: `organizations/invitations/${invitation.id}/resend`,
                                fields: [],
                              })
                            }
                          >
                            Resend
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setForm({
                                title: `Revoke invitation for ${invitation.email}?`,
                                path: `organizations/invitations/${invitation.id}/revoke`,
                                fields: [],
                              })
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      );
                    },
                  },
                ]}
              />
              <TeamPagination
                page={invitationPage}
                total={invitations?.total ?? 0}
                onPage={setInvitationPage}
              />
            </>
          ) : view === "Settings" ? (
            <DataTable
              rows={filtered}
              columns={[
                col("name", "Role", (v) => v.replaceAll("_", " ")),
                {
                  header: "Permissions",
                  cell: ({ row }) => (
                    <div className="permission-list">
                      {row.original.permissions.map((p: string) => (
                        <span className="badge" key={p}>
                          {p}
                        </span>
                      ))}
                    </div>
                  ),
                },
                {
                  header: "Configure",
                  cell: ({ row }) => (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          title: `Configure ${row.original.name}`,
                          path: "organizations/roles",
                          fields: [
                            {
                              name: "permissions",
                              label: "Permissions (comma separated)",
                              defaultValue: row.original.permissions.join(", "),
                              hint: "Use permission names from the current role catalog. Invalid names are rejected.",
                            },
                          ],
                          build: (v) => ({
                            name: row.original.name,
                            permissions: v.permissions
                              .split(",")
                              .map((p: string) => p.trim())
                              .filter(Boolean),
                          }),
                        })
                      }
                    >
                      Edit role
                    </Button>
                  ),
                },
              ]}
            />
          ) : scoped && !projectId ? (
            <Empty
              title="Choose your project"
              text="Select a project above to view its operational records."
            />
          ) : scoped && detail ? (
            <>
              {activeTab === "Overview" && (
                <>
                  <div className="project-summary">
                    <span>{status(detail.status)}</span>
                    <span>
                      Manager <b>{detail.manager || "Unassigned"}</b>
                    </span>
                    <span>
                      Target <b>{date(detail.targetDate)}</b>
                    </span>
                    <span>
                      Contract <b>{money(detail.contractValue)}</b>
                    </span>
                  </div>
                  <div className="section-heading">
                    <h2>Material progress</h2>
                    <span className="muted">
                      Derived from opening balances and posted operations
                    </span>
                  </div>
                  <BalanceTable rows={data || []} />
                </>
              )}
              {activeTab === "Work Orders" && (
                <>
                  <Section
                    title="Work orders"
                    action={
                      can("workorder.manage") ? (
                        <Button
                          onClick={() =>
                            setForm({
                              title: "Create work order",
                              path: projectPath("work-orders"),
                              fields: [field("number", "Work order number")],
                            })
                          }
                        >
                          <Plus size={14} />
                          Work order
                        </Button>
                      ) : undefined
                    }
                  />
                  {detail.workOrders.map((wo: any) => (
                    <section className="card order-card" key={wo.id}>
                      <div className="order-heading">
                        <div>
                          <span className="eyebrow">WORK ORDER</span>
                          <h2>{wo.number}</h2>
                        </div>
                        <div className="heading-actions">
                          {status(wo.approvedAt ? "APPROVED" : "DRAFT")}
                          <span className="muted">v{wo.version}</span>
                          {!wo.approvedAt && can("project.approve") && (
                            <Button
                              variant="outline"
                              onClick={() =>
                                setForm({
                                  title: "Approve work order",
                                  path: projectPath(
                                    `work-orders/${wo.id}/approve`,
                                  ),
                                  fields: [],
                                })
                              }
                            >
                              Approve
                            </Button>
                          )}
                          {!wo.approvedAt && can("workorder.manage") && (
                            <Button
                              onClick={() =>
                                setForm({
                                  title: "Add BOQ item",
                                  path: projectPath(
                                    `work-orders/${wo.id}/items`,
                                  ),
                                  fields: [
                                    {
                                      name: "materialId",
                                      label: "Catalog material",
                                      options: materials
                                        .filter((m) => m.active)
                                        .map((m) => ({
                                          value: m.id,
                                          label: m.name,
                                        })),
                                    },
                                    {
                                      name: "ordered",
                                      label: "Approved order quantity",
                                      type: "number",
                                      step: "0.0001",
                                    },
                                    {
                                      name: "supplyRate",
                                      label: "Contracted supply rate",
                                      type: "number",
                                      step: "0.01",
                                    },
                                    {
                                      name: "installationRate",
                                      label: "Installation rate",
                                      type: "number",
                                      step: "0.01",
                                    },
                                    {
                                      name: "taxRate",
                                      label: "Tax %",
                                      type: "number",
                                      step: "0.01",
                                      defaultValue: "18",
                                    },
                                    {
                                      name: "reason",
                                      label: "Revision reason",
                                    },
                                  ],
                                })
                              }
                            >
                              <Plus size={14} />
                              BOQ item
                            </Button>
                          )}
                        </div>
                      </div>
                      <DataTable
                        rows={wo.items}
                        columns={[
                          {
                            header: "Material",
                            accessorFn: (r) => r.material.name,
                          },
                          col("ordered", "Ordered", number),
                          col("supplyRate", "Supply rate", money),
                          col("installationRate", "Installation rate", money),
                          col("taxRate", "Tax %"),
                        ]}
                      />
                    </section>
                  ))}
                  {!detail.workOrders.length && (
                    <Empty
                      title="No work orders"
                      text="Create a work order and add its BOQ items before recording operations."
                    />
                  )}
                </>
              )}
              {activeTab === "BOQ" && (
                <>
                  <Section
                    title="Bill of quantities"
                    action={
                      can("import.create") ? (
                        <Button
                          variant="outline"
                          onClick={() => setImportOpen(true)}
                        >
                          <Upload size={14} />
                          Import tracker
                        </Button>
                      ) : undefined
                    }
                  />
                  <BalanceTable rows={data || []} />
                </>
              )}
              {activeTab === "Supply" && (
                <>
                  <Section
                    title="Stock movement ledger"
                    action={
                      <>
                        {can("stock.reverse") && (
                          <Button
                            variant="outline"
                            onClick={() => stockForm("returns")}
                          >
                            Return stock
                          </Button>
                        )}
                        {can("stock.create") && (
                          <Button onClick={() => stockForm()}>
                            <Plus size={14} />
                            Goods receipt
                          </Button>
                        )}
                      </>
                    }
                  />
                  <DataTable
                    rows={filtered}
                    columns={[
                      col("createdAt", "Posted", date),
                      {
                        header: "Material",
                        accessorFn: (r) => r.boqItem.material.name,
                      },
                      col("kind", "Movement", status),
                      col("quantity", "Quantity", number),
                      col("reference", "Reference"),
                      col("reason", "Notes"),
                    ]}
                  />
                  <p className="table-note">
                    Accepted receipts add stock. Approved installation consumes
                    it. Corrections append a compensating entry.
                  </p>
                </>
              )}
              {activeTab === "Installation" && (
                <>
                  <Section
                    title="Installation reports"
                    action={
                      can("installation.create") ? (
                        <Button onClick={installForm}>
                          <Plus size={14} />
                          New report
                        </Button>
                      ) : undefined
                    }
                  />
                  <DataTable
                    rows={filtered}
                    columns={[
                      col("reportDate", "Progress date", date),
                      {
                        header: "Material",
                        accessorFn: (r) => r.boqItem.material.name,
                      },
                      col("area", "Area"),
                      col("quantity", "Quantity", number),
                      col("status", "Status", status),
                      {
                        header: "Workflow",
                        cell: ({ row }) => {
                          const r = row.original;
                          return (
                            <div className="row-actions">
                              {r.status === "DRAFT" &&
                                can("installation.create") && (
                                  <Button
                                    variant="outline"
                                    onClick={() => transition(r, "SUBMITTED")}
                                  >
                                    Submit
                                  </Button>
                                )}
                              {r.status === "SUBMITTED" &&
                                can("installation.verify") && (
                                  <Button
                                    variant="outline"
                                    onClick={() => transition(r, "VERIFIED")}
                                  >
                                    Verify
                                  </Button>
                                )}
                              {r.status === "VERIFIED" &&
                                can("installation.approve") && (
                                  <Button
                                    onClick={() => transition(r, "APPROVED")}
                                  >
                                    Approve
                                  </Button>
                                )}
                              {["SUBMITTED", "VERIFIED"].includes(r.status) &&
                                can("installation.approve") && (
                                  <Button
                                    variant="ghost"
                                    onClick={() => transition(r, "REJECTED")}
                                  >
                                    Reject
                                  </Button>
                                )}
                              {r.status === "APPROVED" &&
                                can("installation.approve") && (
                                  <Button
                                    variant="ghost"
                                    onClick={() => transition(r, "REVERSED")}
                                  >
                                    Reverse
                                  </Button>
                                )}
                            </div>
                          );
                        },
                      },
                    ]}
                  />
                </>
              )}
              {activeTab === "Billing" && (
                <>
                  <Section
                    title="Invoices & collections"
                    action={
                      can("invoice.create") ? (
                        <Button onClick={invoiceForm}>
                          <Plus size={14} />
                          Draft invoice
                        </Button>
                      ) : undefined
                    }
                  />
                  <DataTable
                    rows={filtered}
                    columns={[
                      col("number", "Invoice"),
                      col("kind", "Type"),
                      col("status", "Status", status),
                      col("total", "Total", money),
                      col("paid", "Paid", money),
                      col("outstanding", "Outstanding", money),
                      col("dueDate", "Due", date),
                      {
                        header: "Actions",
                        cell: ({ row }) => (
                          <div className="row-actions">
                            {row.original.status === "DRAFT" &&
                              can("invoice.approve") && (
                                <Button
                                  onClick={() =>
                                    setForm({
                                      title: "Approve & issue invoice",
                                      path: projectPath(
                                        `invoices/${row.original.id}/issue`,
                                      ),
                                      fields: [],
                                    })
                                  }
                                >
                                  Issue
                                </Button>
                              )}
                            {row.original.status === "ISSUED" &&
                              Number(row.original.outstanding) > 0 &&
                              can("payment.create") && (
                                <Button
                                  variant="outline"
                                  onClick={() => paymentForm(row.original)}
                                >
                                  Payment
                                </Button>
                              )}
                            {row.original.status !== "CANCELLED" &&
                              can("invoice.approve") && (
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    setForm({
                                      title: "Cancel invoice",
                                      path: projectPath(
                                        `invoices/${row.original.id}/cancel`,
                                      ),
                                      fields: [
                                        field("reason", "Cancellation reason"),
                                      ],
                                    })
                                  }
                                >
                                  Cancel
                                </Button>
                              )}
                          </div>
                        ),
                      },
                    ]}
                  />
                  <p className="table-note">
                    Historical billed quantities remain opening balances. They
                    do not represent issued invoices or customer payments.
                  </p>
                </>
              )}
              {activeTab === "Procurement" && (
                <Procurement
                  data={filtered}
                  api={api}
                  base={projectPath("")}
                  can={can}
                  items={itemOptions}
                  setForm={setForm}
                  setError={setError}
                />
              )}
              {activeTab === "Tasks" && (
                <>
                  <Section
                    title="Project tasks"
                    action={
                      <>
                        <div className="segmented">
                          {["List", "Kanban"].map((m) => (
                            <button
                              key={m}
                              onClick={() => setTaskMode(m)}
                              className={taskMode === m ? "selected" : ""}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                        {can("task.manage") && (
                          <Button onClick={() => taskForm()}>
                            <Plus size={14} />
                            Task
                          </Button>
                        )}
                      </>
                    }
                  />
                  {taskMode === "Kanban" ? (
                    <div className="kanban">
                      {[
                        "TODO",
                        "IN_PROGRESS",
                        "BLOCKED",
                        "IN_REVIEW",
                        "CHANGES_REQUESTED",
                        "DONE",
                      ].map((s) => (
                        <div key={s}>
                          <h3>
                            {s.replaceAll("_", " ")}{" "}
                            <span>
                              {filtered.filter((t) => t.status === s).length}
                            </span>
                          </h3>
                          {filtered
                            .filter((t) => t.status === s)
                            .map((t) => (
                              <article className="card" key={t.id}>
                                <span className="badge">{t.priority}</span>
                                <h3>{t.title}</h3>
                                <p>{t.description}</p>
                                <small className="muted">
                                  Due {date(t.dueDate)}
                                </small>
                                {taskStatus(t, projectId)}
                                {can("task.manage") && can("project.edit") && (
                                  <button
                                    className="text-button"
                                    onClick={() => taskForm(t)}
                                  >
                                    Edit task
                                  </button>
                                )}
                              </article>
                            ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <DataTable
                      rows={filtered}
                      columns={[
                        col("title", "Task"),
                        col("priority", "Priority", status),
                        col("dueDate", "Due date", date),
                        {
                          header: "Status",
                          cell: ({ row }) =>
                            taskStatus(row.original, projectId),
                        },
                        ...(can("task.manage") && can("project.edit")
                          ? [
                              {
                                header: "Manage",
                                cell: ({ row }: any) => (
                                  <button
                                    className="text-button"
                                    onClick={() => taskForm(row.original)}
                                  >
                                    Edit task
                                  </button>
                                ),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </>
              )}
              {activeTab === "Contacts" && (
                <>
                  <Section
                    title="Sites & contacts"
                    action={
                      can("project.edit") ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setForm({
                                title: "Add project site",
                                path: projectPath("sites"),
                                fields: [
                                  field("name", "Site name"),
                                  {
                                    ...field("address", "Address"),
                                    required: false,
                                  },
                                ],
                              })
                            }
                          >
                            <Plus size={14} />
                            Site
                          </Button>
                          <Button
                            onClick={() =>
                              setForm({
                                title: "Add contact",
                                path: projectPath("contacts"),
                                fields: [
                                  field("name", "Contact name"),
                                  {
                                    name: "role",
                                    label: "Contact role",
                                    options: [
                                      "Project manager",
                                      "Project in-charge",
                                      "Engineer in-charge",
                                      "Contact person",
                                      "Accountant",
                                      "Billing",
                                      "Stores",
                                      "Procurement",
                                    ].map((v) => ({ value: v, label: v })),
                                  },
                                  {
                                    ...field("email", "Email", "email"),
                                    required: false,
                                  },
                                  {
                                    ...field("phone", "Phone"),
                                    required: false,
                                  },
                                ],
                              })
                            }
                          >
                            <Plus size={14} />
                            Contact
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                  <div className="site-pills">
                    {detail.sites.map((s: any) => (
                      <span className="badge" key={s.id}>
                        {s.name} · {s.address}
                      </span>
                    ))}
                  </div>
                  <DataTable
                    rows={detail.contacts}
                    columns={[
                      col("name", "Name"),
                      col("role", "Role"),
                      col("email", "Email"),
                      col("phone", "Phone"),
                    ]}
                  />
                </>
              )}
              {activeTab === "Documents" && (
                <Documents
                  rows={filtered}
                  api={api}
                  base={projectPath("")}
                  canUpload={can("document.manage")}
                  reload={reload}
                />
              )}
              {activeTab === "Activity" && (
                <>
                  <Section title="Project activity" />
                  <div className="card timeline">
                    {filtered.map((r) => (
                      <div key={r.id}>
                        <span className="timeline-dot" />
                        <div>
                          <b>{r.action.replaceAll(".", " ")}</b>
                          <p>
                            {date(r.createdAt)} ·{" "}
                            {new Date(r.createdAt).toLocaleTimeString("en-IN")}
                          </p>
                          <code>{r.resourceId}</code>
                        </div>
                      </div>
                    ))}
                    {!filtered.length && (
                      <Empty
                        title="No activity recorded"
                        text="Changes to this project will appear here."
                      />
                    )}
                  </div>
                </>
              )}
              {activeTab === "Settings" && (
                <>
                  <Section title="Project configuration" />
                  <div className="foundation-grid">
                    <section className="card">
                      <h3>Lifecycle</h3>
                      <p>Current status: {status(detail.status)}</p>
                      {can("project.approve") && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            setForm({
                              title: "Change project status",
                              path: projectPath("status"),
                              fields: [
                                {
                                  name: "status",
                                  label: "Next status",
                                  options: [
                                    "PLANNED",
                                    "ACTIVE",
                                    "ON_HOLD",
                                    "DELAYED",
                                    "COMPLETED",
                                    "CLOSED",
                                    "CANCELLED",
                                  ].map((v) => ({ value: v, label: v })),
                                },
                                field("reason", "Reason"),
                              ],
                              build: (v) => ({ ...v, version: detail.version }),
                            })
                          }
                        >
                          Change status
                        </Button>
                      )}
                    </section>
                    <section className="card">
                      <h3>Project details</h3>
                      <p>
                        Update the project description, manager and completion
                        target.
                      </p>
                      {can("project.edit") && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            setForm({
                              title: "Edit project",
                              path: `projects/${projectId}`,
                              method: "PATCH",
                              fields: [
                                {
                                  name: "name",
                                  label: "Project name",
                                  defaultValue: detail.name,
                                },
                                {
                                  name: "manager",
                                  label: "Project manager",
                                  defaultValue: detail.manager,
                                  required: false,
                                },
                                {
                                  name: "targetDate",
                                  label: "Target completion",
                                  type: "date",
                                  defaultValue: detail.targetDate?.slice(0, 10),
                                  required: false,
                                },
                              ],
                              build: (v) => ({ ...v, version: detail.version }),
                            })
                          }
                        >
                          Edit details
                        </Button>
                      )}
                    </section>
                    <section className="card">
                      <h3>Assigned team</h3>
                      <p>
                        {detail.members
                          .map((m: any) => m.membership.user.name)
                          .join(", ") || "No assigned members"}
                      </p>
                      {can("team.manage") && (
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              const team = await api("organizations/team");
                              setForm({
                                title: "Assign project member",
                                path: projectPath("members"),
                                fields: [
                                  {
                                    name: "membershipId",
                                    label: "Team member",
                                    options: team
                                      .filter((m: any) => m.active)
                                      .map((m: any) => ({
                                        value: m.id,
                                        label: m.user.name,
                                      })),
                                  },
                                ],
                              });
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Assign member
                        </Button>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          ) : null}
          <footer className="page-footer">
            <span>FIELDWORK · PROJECT OPERATIONS</span>
            <span>One workspace. Every detail accounted for.</span>
          </footer>
        </main>
      </div>
      <Modal
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.title || ""}
      >
        {form && (
          <OperationForm
            key={form.path + form.title}
            spec={form}
            api={api}
            onCancel={() => setForm(null)}
            onDone={() => {
              form.onSaved?.();
              setForm(null);
              setSuccess("Saved to your workspace.");
              void reload();
            }}
          />
        )}
      </Modal>
      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import historical tracker"
        description="Preview and reconcile your source before posting opening balances."
      >
        <ImportForm
          api={api}
          base={projectPath("imports/")}
          workOrders={detail?.workOrders || []}
          done={() => {
            setImportOpen(false);
            setSuccess("Opening balances imported.");
            void reload();
          }}
        />
      </Modal>
    </div>
  );
}
function col(
  key: string,
  label: string,
  render?: (v: any) => any,
): ColumnDef<any> {
  return {
    accessorKey: key,
    header: label,
    cell: (info) =>
      render ? render(info.getValue()) : (info.getValue() ?? "—"),
  };
}
function Metric({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: any;
  note: string;
  icon: any;
}) {
  return (
    <article className="card metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <b>{value}</b>
      <p>{note}</p>
    </article>
  );
}
function Progress({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="progress-label">
        <span>{label}</span>
        <b>{value === null ? "No approved value" : `${value}%`}</b>
      </div>
      <div className="progress-track">
        <span style={{ width: `${Math.min(100, Number(value || 0))}%` }} />
      </div>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: any;
}) {
  return (
    <div className="empty-state">
      <span>
        <FolderKanban size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="table-search">
      <Search size={15} />
      <input
        placeholder="Search loaded records…"
        aria-label="Search records"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Section({ title, action }: { title: string; action?: any }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <div className="heading-actions">{action}</div>
    </div>
  );
}
type DashboardTask = {
  id: string;
  title: string;
  dueDate: string | null;
  priority: string;
  status: string;
};

type DashboardProject = {
  id: string;
  code: string;
  name: string;
  status: string;
  city: string;
  client?: { name: string };
  manager: string;
  targetDate: string | null;
  contractValue: string;
  supplyProgress: string | null;
  installationProgress: string | null;
  attention: {
    delayed: boolean;
    pendingApprovals: number;
    overdueInvoices: number;
    overdueTasks: DashboardTask[];
    upcomingTasks: DashboardTask[];
    unscheduledTasks: DashboardTask[];
    upcomingTarget: string | null;
    outstanding: string;
  };
};

const dashboardDate = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

function DashboardProjects({
  projects,
  today,
  money,
  onOpen,
}: {
  projects: DashboardProject[];
  today: string;
  money: (value: string) => string;
  onOpen: (project: DashboardProject, tab?: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const cards = projects.map((project) => {
    const a = project.attention;
    const actionCount =
      Number(a.delayed) +
      a.pendingApprovals +
      a.overdueInvoices +
      a.overdueTasks.length;
    const reminderCount =
      a.upcomingTasks.length + Number(Boolean(a.upcomingTarget));
    const firstReminder = [a.upcomingTasks[0]?.dueDate, a.upcomingTarget]
      .filter(Boolean)
      .sort()[0];
    return { project, actionCount, reminderCount, firstReminder };
  });
  const actionProjects = cards.filter((card) => card.actionCount > 0).length;
  const reminderProjects = cards.filter(
    (card) => card.reminderCount > 0,
  ).length;
  const visible = cards
    .filter(
      ({ project, actionCount, reminderCount }) =>
        (filter !== "actions" || actionCount > 0) &&
        (filter !== "reminders" || reminderCount > 0) &&
        [
          project.name,
          project.code,
          project.client?.name,
          project.city,
          project.manager,
        ].some((value) =>
          value?.toLowerCase().includes(search.trim().toLowerCase()),
        ),
    )
    .sort(
      (a, b) =>
        Number(b.actionCount > 0) - Number(a.actionCount > 0) ||
        (a.firstReminder ?? "~").localeCompare(b.firstReminder ?? "~") ||
        a.project.name.localeCompare(b.project.name),
    );

  return (
    <section className="project-board" aria-labelledby="project-board-title">
      <div className="project-board-heading">
        <div>
          <h2 id="project-board-title">Project portfolio</h2>
          <p>
            {actionProjects} of {projects.length} projects need action
          </p>
        </div>
        <time dateTime={today.slice(0, 10)}>{dashboardDate(today)}</time>
      </div>
      <div className="project-board-toolbar">
        <div
          className="project-filters"
          aria-label="Filter projects"
          role="group"
        >
          {[
            { value: "all", label: "All projects", count: projects.length },
            {
              value: "actions",
              label: "Action required",
              count: actionProjects,
            },
            {
              value: "reminders",
              label: "Upcoming reminders",
              count: reminderProjects,
            },
          ].map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
        <SearchBox value={search} onChange={setSearch} />
      </div>
      <div className="project-board-grid">
        {visible.map(({ project: p, actionCount }) => {
          const a = p.attention;
          const due = (value: string) =>
            value === today ? "Due today" : dashboardDate(value);
          const reminders = [
            ...a.upcomingTasks.map((task) => ({ ...task, tab: "Tasks" })),
            ...(a.upcomingTarget
              ? [
                  {
                    id: "target",
                    title: "Project target date",
                    dueDate: a.upcomingTarget,
                    tab: "Overview",
                  },
                ]
              : []),
          ].sort((first, second) =>
            (first.dueDate ?? "").localeCompare(second.dueDate ?? ""),
          );
          return (
            <article
              key={p.id}
              className={`card board-card${actionCount ? " board-card-urgent" : ""}`}
            >
              <header>
                <div className="board-card-top">
                  <span className="eyebrow">{p.code}</span>
                  {status(p.status)}
                </div>
                <h3>{p.name}</h3>
                <p>{[p.client?.name, p.city].filter(Boolean).join(" · ")}</p>
              </header>
              <dl className="board-facts">
                <div>
                  <dt>Project manager</dt>
                  <dd>{p.manager || "Unassigned"}</dd>
                </div>
                <div>
                  <dt>Target date</dt>
                  <dd>
                    {p.targetDate ? dashboardDate(p.targetDate) : "Not set"}
                  </dd>
                </div>
                <div>
                  <dt>Contract value</dt>
                  <dd>{money(p.contractValue)}</dd>
                </div>
                <div>
                  <dt>Outstanding billing</dt>
                  <dd>{money(a.outstanding)}</dd>
                </div>
              </dl>
              <div className="board-progress">
                <Progress label="Material supply" value={p.supplyProgress} />
                <Progress label="Installation" value={p.installationProgress} />
              </div>
              <section
                className={`board-section${actionCount ? " board-actions" : ""}`}
              >
                <h4>
                  {actionCount ? (
                    <AlertCircle size={16} />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {actionCount
                    ? `Action required · ${actionCount}`
                    : "No urgent actions"}
                </h4>
                {actionCount > 0 && (
                  <ul>
                    {a.delayed && (
                      <li>
                        <button onClick={() => onOpen(p)}>
                          Review project delay
                        </button>
                      </li>
                    )}
                    {a.pendingApprovals > 0 && (
                      <li>
                        <button onClick={() => onOpen(p, "Installation")}>
                          {a.pendingApprovals} pending installation{" "}
                          {a.pendingApprovals === 1 ? "approval" : "approvals"}
                        </button>
                      </li>
                    )}
                    {a.overdueInvoices > 0 && (
                      <li>
                        <button onClick={() => onOpen(p, "Billing")}>
                          {a.overdueInvoices} overdue{" "}
                          {a.overdueInvoices === 1 ? "invoice" : "invoices"}
                        </button>
                      </li>
                    )}
                    {a.overdueTasks.slice(0, 3).map((task) => (
                      <li key={task.id}>
                        <button onClick={() => onOpen(p, "Tasks")}>
                          <span>{task.title}</span>
                          <small>{dashboardDate(task.dueDate!)}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {a.overdueTasks.length > 3 && (
                  <details>
                    <summary>
                      Show {a.overdueTasks.length - 3} more overdue tasks
                    </summary>
                    <ul>
                      {a.overdueTasks.slice(3).map((task) => (
                        <li key={task.id}>
                          <button onClick={() => onOpen(p, "Tasks")}>
                            <span>{task.title}</span>
                            <small>{dashboardDate(task.dueDate!)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
              <section className="board-section board-reminders">
                <h4>
                  <CalendarClock size={16} /> Upcoming reminders
                </h4>
                {reminders.length ? (
                  <ul>
                    {reminders.slice(0, 3).map((reminder) => (
                      <li key={reminder.id}>
                        <button onClick={() => onOpen(p, reminder.tab)}>
                          <span>{reminder.title}</span>
                          <small>{due(reminder.dueDate!)}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No upcoming dates</p>
                )}
                {reminders.length > 3 && (
                  <details>
                    <summary>
                      Show {reminders.length - 3} more reminders
                    </summary>
                    <ul>
                      {reminders.slice(3).map((reminder) => (
                        <li key={reminder.id}>
                          <button onClick={() => onOpen(p, reminder.tab)}>
                            <span>{reminder.title}</span>
                            <small>{due(reminder.dueDate!)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
              {a.unscheduledTasks.length > 0 && (
                <details className="board-section">
                  <summary>
                    {a.unscheduledTasks.length}{" "}
                    {a.unscheduledTasks.length === 1 ? "task" : "tasks"} without
                    a due date
                  </summary>
                  <ul>
                    {a.unscheduledTasks.map((task) => (
                      <li key={task.id}>
                        <button onClick={() => onOpen(p, "Tasks")}>
                          <span>{task.title}</span>
                          <small>{task.priority}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <footer>
                <button className="text-button" onClick={() => onOpen(p)}>
                  Open project <ArrowUpRight size={16} />
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <Empty
          title={projects.length ? "No matching projects" : "No projects yet"}
          text={
            projects.length
              ? "Try another filter or search."
              : "Your projects will appear here after you create them."
          }
        />
      )}
    </section>
  );
}
function ProjectCards({
  projects,
  onOpen,
}: {
  projects: any[];
  onOpen: (v: any) => void;
}) {
  return (
    <div className="project-grid">
      {projects.map((p) => (
        <button
          className="card project-card"
          key={p.id}
          onClick={() => onOpen(p)}
        >
          <div>
            <span className="project-monogram">{p.code.slice(0, 2)}</span>
            {status(p.status)}
          </div>
          <span className="eyebrow">{p.code}</span>
          <h3>{p.name}</h3>
          <p>
            {p.city} · {p.client?.name}
          </p>
          <footer>
            <span>{p.manager || "Manager unassigned"}</span>
            <ArrowUpRight size={17} />
          </footer>
        </button>
      ))}
    </div>
  );
}
function TeamPagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / 25));
  return (
    <div className="list-toolbar" aria-label="Pagination">
      <span>
        {total} records · Page {page} of {lastPage}
      </span>
      <div className="heading-actions">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function DataTable({
  rows,
  columns,
}: {
  rows: any[];
  columns: ColumnDef<any>[];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="card table-card">
      <table>
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id}>
                  <button
                    className="sort-button"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === "asc"
                      ? " ↑"
                      : h.column.getIsSorted() === "desc"
                        ? " ↓"
                        : ""}
                  </button>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length}>
                <Empty
                  title="No records yet"
                  text="Records will appear here after they are saved."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function BalanceTable({ rows }: { rows: any[] }) {
  return (
    <DataTable
      rows={rows}
      columns={[
        col("material", "Material"),
        col("uom", "UOM"),
        col("ordered", "Ordered", number),
        col("supplied", "Supplied", number),
        col("pendingSupply", "Pending supply", number),
        col("installed", "Installed", number),
        col("pendingInstallation", "Pending installation", number),
        col("available", "On hand", number),
        col("supplyUnbilled", "Supply unbilled", number),
        col("installationUnbilled", "Install unbilled", number),
      ]}
    />
  );
}
function OperationForm({
  spec,
  api,
  onDone,
  onCancel,
}: {
  spec: FormSpec;
  api: Api;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    for (const f of spec.fields)
      if (f.required === false && values[f.name] === "") delete values[f.name];
    try {
      await api(
        spec.path,
        spec.method || "POST",
        spec.build ? spec.build(values) : values,
        key,
      );
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {!spec.fields.length && (
        <p className="muted">
          Confirm this action. The server will validate permissions, current
          state and eligible quantities.
        </p>
      )}
      <div className="form-grid">
        {spec.fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.required === false ? "" : " *"}
            {f.options ? (
              <select
                name={f.name}
                required={f.required !== false}
                defaultValue={f.defaultValue ?? ""}
              >
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.name}
                type={f.type || "text"}
                autoComplete={
                  f.name === "password" ? "new-password" : undefined
                }
                minLength={f.name === "password" ? 12 : undefined}
                maxLength={f.name === "password" ? 128 : undefined}
                required={f.required !== false}
                defaultValue={f.defaultValue}
                step={f.step || "1"}
                min={f.type === "number" ? 0 : undefined}
              />
            )}
            <small>{f.hint}</small>
          </label>
        ))}
      </div>
      <div className="form-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : null}
          {busy ? "Saving…" : "Confirm & save"}
        </Button>
      </div>
    </form>
  );
}
function Procurement({
  data,
  api,
  base,
  can,
  items,
  setForm,
  setError,
}: {
  data: any[];
  api: Api;
  base: string;
  can: (p: string) => boolean;
  items: Option[];
  setForm: (f: FormSpec) => void;
  setError: (e: string) => void;
}) {
  return (
    <>
      <Section
        title="Procurement & dispatch"
        action={
          can("procurement.manage") ? (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  setForm({
                    title: "Add supplier",
                    path: "suppliers",
                    fields: [
                      { name: "name", label: "Supplier name" },
                      {
                        name: "email",
                        label: "Email",
                        type: "email",
                        required: false,
                      },
                      {
                        name: "taxId",
                        label: "Tax registration",
                        required: false,
                      },
                    ],
                  })
                }
              >
                Supplier
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const suppliers = await api("suppliers");
                    setForm({
                      title: "Create purchase order",
                      path: base + "purchase-orders",
                      fields: [
                        { name: "number", label: "PO number" },
                        {
                          name: "supplierId",
                          label: "Supplier",
                          options: suppliers.map((s: any) => ({
                            value: s.id,
                            label: s.name,
                          })),
                        },
                        {
                          name: "boqItemId",
                          label: "Material",
                          options: items,
                        },
                        {
                          name: "quantity",
                          label: "Purchase quantity",
                          type: "number",
                          step: "0.0001",
                        },
                        {
                          name: "rate",
                          label: "Unit rate",
                          type: "number",
                          step: "0.01",
                        },
                      ],
                      build: ({ boqItemId, quantity, rate, ...v }) => ({
                        ...v,
                        lines: [{ boqItemId, quantity, rate }],
                      }),
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Plus size={14} />
                Purchase order
              </Button>
            </>
          ) : undefined
        }
      />
      {data.map((po) => (
        <section className="card order-card" key={po.id}>
          <div className="order-heading">
            <div>
              <h2>{po.number}</h2>
              <p className="muted">{po.supplier.name}</p>
            </div>
            <div className="heading-actions">
              {status(po.status)}
              {po.status === "DRAFT" && can("project.approve") && (
                <Button
                  onClick={() =>
                    setForm({
                      title: "Approve purchase order",
                      path: base + `purchase-orders/${po.id}/approve`,
                      fields: [],
                    })
                  }
                >
                  Approve
                </Button>
              )}
            </div>
          </div>
          {po.lines.map((l: any) => (
            <div className="po-line" key={l.id}>
              <div>
                <b>{l.boqItem.material.name}</b>
                <p>
                  {number(l.quantity)} ordered · {l.dispatches.length} dispatch
                  records
                </p>
              </div>
              {po.status === "APPROVED" && can("procurement.manage") && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setForm({
                      title: "Record dispatch",
                      path: base + "dispatches",
                      fields: [
                        { name: "challan", label: "Delivery challan" },
                        {
                          name: "quantity",
                          label: "Dispatched quantity",
                          type: "number",
                          step: "0.0001",
                        },
                      ],
                      build: (v) => ({ ...v, purchaseLineId: l.id }),
                    })
                  }
                >
                  Dispatch
                </Button>
              )}
              <div className="dispatch-list">
                {l.dispatches.map((d: any) => (
                  <div key={d.id}>
                    <span>
                      {d.challan} · {number(d.quantity)} dispatched ·{" "}
                      {d.receipts.length} receipts
                    </span>
                    {can("stock.create") && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setForm({
                            title: "Receive dispatched goods",
                            path: base + "goods-receipts",
                            fields: [
                              { name: "reference", label: "Receipt reference" },
                              {
                                name: "accepted",
                                label: "Accepted quantity",
                                type: "number",
                                step: "0.01",
                              },
                              {
                                name: "damaged",
                                label: "Damaged quantity",
                                type: "number",
                                step: "0.01",
                                defaultValue: "0",
                              },
                              {
                                name: "rejected",
                                label: "Rejected quantity",
                                type: "number",
                                step: "0.01",
                                defaultValue: "0",
                              },
                            ],
                            build: (v) => ({ ...v, dispatchId: d.id }),
                          })
                        }
                      >
                        Receive
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
      {!data.length && (
        <Empty
          title="No purchase orders yet"
          text="Add a supplier and create a purchase order against an approved BOQ."
        />
      )}
    </>
  );
}
function ImportForm({
  api,
  base,
  workOrders,
  done,
}: {
  api: Api;
  base: string;
  workOrders: any[];
  done: () => void;
}) {
  const [source, setSource] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mappingText, setMappingText] = useState("");
  async function loadFile(file: File) {
    setError("");
    setPreview(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Maximum file size is 5 MB");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    setSource({ fileName: file.name, content: btoa(binary) });
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const values = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const input = {
            ...source,
            ...(values.headerRow
              ? { headerRow: Number(values.headerRow) }
              : {}),
            ...(mappingText ? { mapping: JSON.parse(mappingText) } : {}),
            ...(values.skipRows
              ? { skipRows: String(values.skipRows).split(",").map(Number) }
              : {}),
            ...(values.dateFormat ? { dateFormat: values.dateFormat } : {}),
          };
          if (!preview) {
            const p = await api(base + "preview", "POST", input);
            setPreview(p);
          } else {
            await api(base + "confirm", "POST", {
              ...input,
              workOrderId: values.workOrderId,
              asOf: values.asOf,
              confirmed: values.confirmed === "on",
              acceptedReceiptAssumption: values.confirmed === "on",
              acknowledgeWarnings: values.confirmed === "on",
            });
            done();
          }
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <div role="alert" className="notice">
          {error}
        </div>
      )}
      <label>
        Excel or CSV tracker
        <input
          type="file"
          accept=".csv,.xlsx"
          required
          onChange={(e) =>
            e.target.files?.[0] && void loadFile(e.target.files[0])
          }
        />
      </label>
      <div className="form-grid">
        <label>
          Header row override
          <input
            name="headerRow"
            type="number"
            min={1}
            max={200}
            onChange={() => setPreview(null)}
            placeholder="Auto-detect"
          />
        </label>
        <label>
          Skipped row numbers
          <input
            name="skipRows"
            placeholder="e.g. 12, 16"
            onChange={() => setPreview(null)}
          />
        </label>
        <label>
          Source date format
          <select name="dateFormat" onChange={() => setPreview(null)}>
            <option value="">No date columns</option>
            {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Column mapping override (JSON, zero-based indices)
        <textarea
          value={mappingText}
          onChange={(e) => {
            setMappingText(e.target.value);
            setPreview(null);
          }}
          placeholder={
            '{"material":0,"ordered":1,"supplied":2,"installed":4,"supplyBilled":6,"installationBilled":7}'
          }
        />
      </label>
      {preview && (
        <>
          <p className="muted">
            Detected header at row {preview.headerRow}. {preview.records.length}{" "}
            material records.
          </p>
          {preview.warnings.map((w: string) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
          <div className="import-preview">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Material</th>
                  <th>Ordered</th>
                  <th>Supplied</th>
                  <th>Installed</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {preview.records.map((r: any) => (
                  <tr key={r.sourceRow}>
                    <td>{r.sourceRow}</td>
                    <td>{r.material}</td>
                    <td>{r.ordered}</td>
                    <td>{r.supplied}</td>
                    <td>{r.installed}</td>
                    <td>{r.errors.join("; ") || "Valid"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            Target work order
            <select name="workOrderId" required>
              {workOrders.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opening balance as-of date
            <input type="date" name="asOf" required />
          </label>
          <label className="checkbox-label">
            <input name="confirmed" type="checkbox" required />I have reconciled
            the source. Supplied quantities are accepted receipts and installed
            quantities are valid installations. I accept the displayed warnings
            and opening billed balances.
          </label>
        </>
      )}
      <div className="form-actions">
        {preview && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setPreview(null)}
          >
            Back to mapping
          </Button>
        )}
        <Button disabled={busy || !source || preview?.hasErrors}>
          {busy
            ? "Processing…"
            : preview
              ? "Confirm opening balances"
              : "Preview import"}
        </Button>
      </div>
    </form>
  );
}
function Documents({
  rows,
  api,
  base,
  canUpload,
  reload,
}: {
  rows: any[];
  api: Api;
  base: string;
  canUpload: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Section
        title="Private project documents"
        action={
          canUpload ? (
            <label className="button outline file-button">
              <Upload size={14} />
              {busy ? "Uploading…" : "Upload document"}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  setError("");
                  try {
                    const auth = await api(base + "documents/upload", "POST", {
                      name: file.name,
                      size: file.size,
                      mimeType: file.type,
                    });
                    const upload = await fetch(auth.url, {
                      method: "PUT",
                      headers: { "Content-Type": file.type },
                      body: file,
                    });
                    if (!upload.ok)
                      throw new Error("Object storage upload failed");
                    await api(base + `documents/${auth.id}/complete`, "POST");
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          ) : undefined
        }
      />
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <DataTable
        rows={rows}
        columns={[
          col("name", "Document"),
          col("size", "Size", (v) => `${number(Number(v) / 1024)} KB`),
          col("status", "Security status", status),
          col("createdAt", "Added", date),
          {
            header: "Download",
            cell: ({ row }) =>
              row.original.status === "CLEAN" ? (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const result = await api(
                        base + `documents/${row.original.id}/download`,
                      );
                      window.open(result.url, "_blank", "noopener,noreferrer");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Download
                </Button>
              ) : (
                <span className="muted">Awaiting verification</span>
              ),
          },
        ]}
      />
      <p className="table-note">
        Files remain quarantined until file verification and the configured
        malware scanner succeed.
      </p>
    </>
  );
}
