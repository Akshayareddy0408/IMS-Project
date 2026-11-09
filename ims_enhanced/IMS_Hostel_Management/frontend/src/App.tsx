import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowUpRight, Bell, Building2, CheckCircle2,
  ChevronDown, ClipboardList, Clock3, DoorOpen, LayoutDashboard, Menu, Package,
  Plus, Search, Settings, ShieldCheck, Wrench, X
} from "lucide-react";
import { api } from "./api";
import { supabase } from "./supabase";
import type { Complaint, ComplaintActivity, ComplaintStatus, DashboardSummary, Resource, ResourceTransaction, Room, SystemActivity } from "./types";

type Page = "Overview" | "Complaints" | "Resources" | "Accounts" | "Rooms" | "Activity" | "Settings";
type Role = "Student" | "Warden" | "Maintenance Staff" | "Administrator";

const statusOptions: ComplaintStatus[] = ["Submitted", "Reviewed", "Assigned", "In Progress", "Resolved", "Closed"];
function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function StatusPill({ status }: { status: ComplaintStatus }) {
  return <span className={`pill status-${status.toLowerCase().replace(/ /g, "-")}`}>{status}</span>;
}

function PriorityPill({ priority }: { priority: Complaint["priority"] }) {
  return <span className={`priority priority-${priority.toLowerCase()}`}><span />{priority}</span>;
}

export function DashboardApp({ initialRole = "Student", email = "", fullName = "", roomNumber = "", onSignOut }: { initialRole?: Role; email?: string; fullName?: string; roomNumber?: string; onSignOut?: () => void }) {
  const [page, setPage] = useState<Page>("Overview");
  const role = initialRole;
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [accountRequests, setAccountRequests] = useState<Awaited<ReturnType<typeof api.accountRequests>>>([]);
  const [accountUsers, setAccountUsers] = useState<Awaited<ReturnType<typeof api.accountUsers>>>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activity, setActivity] = useState<SystemActivity[]>([]);
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof api.notifications>>>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [profileName, setProfileName] = useState(fullName);
  const [profileRoom, setProfileRoom] = useState(roomNumber);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const isManager = role === "Warden" || role === "Administrator";
      const [complaintData, resourceData, summaryData] = await Promise.all([
        api.complaints(), api.resources(), isManager ? api.dashboard() : Promise.resolve(null)
      ]);
      setComplaints(complaintData);
      setResources(resourceData);
      setSummary(summaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect to the API.");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadNotifications = useCallback(async () => {
    try { setNotifications(await api.notifications()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load notifications."); }
  }, []);
  useEffect(() => { void loadNotifications(); }, [loadNotifications]);
  const unreadCount = notifications.filter(item => !item.read_at).length;
  async function markRead(id: string) {
    try { await api.markNotificationRead(id); setNotifications(items => items.map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update notification."); }
  }

  const loadPageData = useCallback(async () => {
    if (page === "Accounts" && role === "Administrator") {
      setPageLoading(true);
      try {
        const [requests, users] = await Promise.all([api.accountRequests(), api.accountUsers()]);
        setAccountRequests(requests); setAccountUsers(users);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load account management."); }
      finally { setPageLoading(false); }
    } else if (page === "Rooms" && (role === "Administrator" || role === "Warden")) {
      setPageLoading(true);
      try { setRooms(await api.rooms()); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not load rooms."); }
      finally { setPageLoading(false); }
    } else if (page === "Activity" && role === "Administrator") {
      setPageLoading(true);
      try { setActivity(await api.activity()); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not load activity history."); }
      finally { setPageLoading(false); }
    }
  }, [page, role]);
  useEffect(() => { void loadPageData(); }, [loadPageData]);

  const filtered = useMemo(() => complaints.filter((item) => {
    const text = `${item.code} ${item.title} ${item.studentName} ${item.room} ${item.category}`.toLowerCase();
    return text.includes(query.toLowerCase());
  }), [complaints, query]);

  async function handleStatus(id: string, status: ComplaintStatus, resolutionNotes?: string) {
    try {
      const updated = await api.updateStatus(id, status, resolutionNotes);
      await refresh();
      setSelected((current) => current?.id === id ? updated : current);
    } catch (e) { setError(e instanceof Error ? e.message : "Status update failed."); }
  }

  async function handleAssign(id: string, assignedTo: string) {
    try {
      const updated = await api.assignComplaint(id, assignedTo);
      await refresh();
      setSelected((current) => current?.id === id ? updated : current);
    } catch (e) { setError(e instanceof Error ? e.message : "Assignment failed."); }
  }

  async function handleQuantity(id: string, quantity: number) {
    try { await api.updateResourceQuantity(id, quantity); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Quantity update failed."); }
  }

  async function handleResourceSave(id: string | null, resource: Omit<Resource, "id">) {
    try {
      if (id) await api.updateResource(id, { name: resource.name, category: resource.category, location: resource.location, minimumStock: resource.minimumStock, unit: resource.unit });
      else await api.createResource(resource);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the inventory item."); throw e; }
  }

  const navItems: { name: Page; icon: typeof LayoutDashboard }[] = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "Complaints", icon: ClipboardList },
    { name: "Resources", icon: Package },
    ...((role === "Administrator" || role === "Warden") ? [{ name: "Rooms" as Page, icon: DoorOpen }] : []),
    ...(role === "Administrator" ? [{ name: "Accounts" as Page, icon: ShieldCheck }, { name: "Activity" as Page, icon: Activity }] : [])
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Building2 size={21} /></div>
          <div><strong>HostelCare</strong><span>IMS PORTAL</span></div>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18}/></button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {navItems.map(({ name, icon: Icon }) => (
            <button key={name} className={`nav-item ${page === name ? "active" : ""}`} onClick={() => { setPage(name); setMobileNav(false); }}>
              <Icon size={18}/><span>{name}</span>{name === "Complaints" && <span className="nav-count">{summary?.openComplaints ?? 0}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-card"><ShieldCheck size={18}/><div><strong>Secure workspace</strong><small>Demo environment</small></div></div>
          <button className={`nav-item ${page === "Settings" ? "active" : ""}`} onClick={() => setPage("Settings")}><Settings size={18}/><span>Settings</span></button>
          <div className="profile">
            <div className="avatar">{(fullName || email || "U").slice(0, 2).toUpperCase()}</div><div className="profile-text"><strong>{fullName || email || "Account"}</strong><small>{role}</small></div><button className="profile-signout" aria-label="Sign out" onClick={onSignOut}><ChevronDown size={16}/></button>
          </div>
        </div>
      </aside>

      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button>
          <div className="breadcrumbs"><span>Hostel Management</span><span className="crumb-slash">/</span><strong>{page}</strong></div>
          <div className="topbar-actions">
            <div className="role-picker"><span>Signed-in role</span><strong>{role}</strong></div>
            <button className="icon-button notification-button" aria-label="Notifications" aria-expanded={showNotifications} onClick={() => { setShowNotifications(value => !value); if (!showNotifications) void loadNotifications(); }}><Bell size={18}/>{unreadCount > 0 && <i className="unread-count">{unreadCount > 9 ? "9+" : unreadCount}</i>}</button>
            {showNotifications && <section className="panel notification-panel"><div className="panel-heading"><div><h2>Notifications</h2><p>{unreadCount} unread</p></div><button className="text-button" onClick={() => setShowNotifications(false)}>Close</button></div>{notifications.length ? notifications.map(item => <button key={item.id} className={`notification-row ${item.read_at ? "" : "notification-unread"}`} onClick={() => { if (!item.read_at) void markRead(item.id); }}><strong>{item.title}</strong><span>{item.message}</span><small>{dateLabel(item.created_at)}</small></button>) : <div className="empty-state">No notifications.</div>}</section>}
            <div className="top-avatar">{(fullName || email || "U").slice(0, 2).toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="alert"><AlertCircle size={17}/><span>{error}</span><button onClick={() => setError("")}><X size={16}/></button></div>}
          {loading || pageLoading ? <div className="loading-state"><div className="spinner"/><span>Loading your workspace…</span></div> : (
            <>
              {page === "Overview" && <Overview role={role} summary={summary} complaints={complaints} resources={resources} onNavigate={setPage} onOpen={setSelected}/>}
              {page === "Complaints" && <ComplaintsPage role={role} complaints={filtered} query={query} setQuery={setQuery} onCreate={() => setShowCreate(true)} onOpen={setSelected}/>}
              {page === "Resources" && <ResourcesPage resources={resources} role={role} onQuantity={handleQuantity} onSave={handleResourceSave}/>}
              {page === "Accounts" && role === "Administrator" && <AccountsPage requests={accountRequests} users={accountUsers} currentEmail={email} onRefresh={loadPageData}/>}
              {page === "Rooms" && (role === "Administrator" || role === "Warden") && <RoomsPage rooms={rooms} canEdit={role === "Administrator"} onRefresh={loadPageData}/>}
              {page === "Activity" && role === "Administrator" && <ActivityPage activity={activity}/>}
              {page === "Settings" && <SettingsPage role={role} email={email} name={profileName} roomNumber={profileRoom} onNameChange={setProfileName} onRoomChange={setProfileRoom}/>}
            </>
          )}
        </div>
      </main>

      {showCreate && <CreateComplaintModal onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); await refresh(); setPage("Complaints"); }}/>}
      {selected && <ComplaintModal complaint={selected} role={role} onClose={() => setSelected(null)} onStatus={handleStatus} onAssign={handleAssign}/>}
    </div>
  );
}

function Overview({ role, summary, complaints, resources, onNavigate, onOpen }: {
  role: Role; summary: DashboardSummary | null; complaints: Complaint[]; resources: Resource[];
  onNavigate: (page: Page) => void; onOpen: (item: Complaint) => void;
}) {
  const latest = [...complaints].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const lowStock = resources.filter((item) => item.quantity <= item.minimumStock);
  return (
    <>
      <div className="welcome-row"><div><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase()}</div><h1>Welcome to HostelCare <span>✦</span></h1><p>Here’s what’s happening across your hostel today.</p></div><button className="button-primary" onClick={() => onNavigate("Complaints")}><ClipboardList size={17}/> View complaints <ArrowUpRight size={16}/></button></div>
      {(role === "Warden" || role === "Administrator") && <div className="stat-grid">
        <StatCard label="Total complaints" value={summary?.totalComplaints ?? 0} detail="All recorded requests" icon={ClipboardList} tint="blue"/>
        <StatCard label="Open complaints" value={summary?.openComplaints ?? 0} detail="Awaiting resolution" icon={Clock3} tint="orange"/>
        <StatCard label="Resolved" value={summary?.resolvedComplaints ?? 0} detail="Successfully completed" icon={CheckCircle2} tint="green"/>
        <StatCard label="Low stock items" value={summary?.lowStockItems ?? 0} detail="Needs inventory attention" icon={Package} tint="purple"/>
      </div>}
      <div className="content-grid">
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>Recent complaints</h2><p>Latest requests from hostel residents</p></div><button className="text-button" onClick={() => onNavigate("Complaints")}>View all <ArrowUpRight size={15}/></button></div>
          <div className="complaint-list">
            {latest.map((item) => <button className="recent-item" key={item.id} onClick={() => onOpen(item)}>
              <div className={`category-icon category-${item.category.toLowerCase().replace(/ /g, "-")}`}><Wrench size={17}/></div>
              <div className="recent-main"><strong>{item.title}</strong><span>{item.code} <i>·</i> Room {item.room}</span></div>
              <div className="recent-right"><StatusPill status={item.status}/><small>{dateLabel(item.createdAt)}</small></div>
            </button>)}
          </div>
          {latest.length === 0 && <div className="empty-state">No complaints have been submitted yet.</div>}
        </section>
        <section className="panel stock-panel">
          <div className="panel-heading"><div><h2>Resource alerts</h2><p>Items at or below minimum stock</p></div><span className="small-count">{lowStock.length} alerts</span></div>
          {lowStock.length ? lowStock.map((item) => <div className="stock-item" key={item.id}>
            <div className="stock-icon"><Package size={17}/></div><div className="stock-main"><strong>{item.name}</strong><small>{item.location}</small><div className="stock-meter"><span style={{width: `${Math.min(100, item.quantity / Math.max(item.minimumStock,1) * 100)}%`}}/></div></div>
            <div className="stock-quantity"><strong>{item.quantity}</strong><small>{item.unit} left</small></div>
          </div>) : <div className="empty-state">All resources are adequately stocked.</div>}
          <button className="stock-footer" onClick={() => onNavigate("Resources")}>Manage inventory <ArrowUpRight size={15}/></button>
        </section>
      </div>
      <div className="bottom-note"><Activity size={16}/><span>Dashboard data is loaded from the HostelCare API.</span></div>
    </>
  );
}

function StatCard({ label, value, detail, icon: Icon, tint }: { label: string; value: number; detail: string; icon: typeof Activity; tint: string }) {
  return <div className="stat-card"><div className={`stat-icon tint-${tint}`}><Icon size={19}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div>;
}

function ComplaintsPage({ role, complaints, query, setQuery, onCreate, onOpen }: {
  role: Role; complaints: Complaint[]; query: string; setQuery: (value: string) => void;
  onCreate: () => void; onOpen: (item: Complaint) => void;
}) {
  return (
    <>
      <div className="page-title-row"><div><div className="eyebrow">SERVICE DESK</div><h1>Complaints</h1><p>Review, assign, and track hostel maintenance requests.</p></div>{role === "Student" && <button className="button-primary" onClick={onCreate}><Plus size={17}/> New complaint</button>}</div>
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>All requests <span className="table-total">{complaints.length}</span></h2><p>Search requests by title, student, room, or ID.</p></div><label className="search-box"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search complaints…"/></label></div>
        <div className="table-wrap"><table><thead><tr><th>COMPLAINT</th><th>STUDENT / ROOM</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>CREATED</th><th/></tr></thead>
          <tbody>{complaints.map((item) => <tr key={item.id} onClick={() => onOpen(item)} className="clickable-row">
            <td><div className="table-complaint"><strong>{item.title}</strong><small>{item.code}</small></div></td><td><div className="table-person"><strong>{item.studentName}</strong><small>Room {item.room}</small></div></td><td><span className="category-text">{item.category}</span></td><td><PriorityPill priority={item.priority}/></td><td><StatusPill status={item.status}/></td><td className="date-cell">{dateLabel(item.createdAt)}</td><td><ArrowUpRight size={16} className="row-arrow"/></td>
          </tr>)}</tbody></table></div>
        {complaints.length === 0 && <div className="empty-state">No matching complaints found.</div>}
      </section>
    </>
  );
}

function ResourcesPage({ resources, role, onQuantity, onSave }: { resources: Resource[]; role: Role; onQuantity: (id: string, quantity: number) => void; onSave: (id: string | null, resource: Omit<Resource, "id">) => Promise<void> }) {
  const emptyForm: Omit<Resource, "id"> = { name: "", category: "", location: "", quantity: 0, minimumStock: 0, unit: "pcs" };
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<ResourceTransaction[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    if (!historyId) return;
    let live = true;
    setHistoryLoading(true); setHistoryError("");
    void api.resourceTransactions(historyId).then(rows => { if (live) setHistory(rows); })
      .catch(e => { if (live) setHistoryError(e instanceof Error ? e.message : "Could not load stock history."); })
      .finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [historyId]);
  function startCreate() { setEditing(null); setForm(emptyForm); setError(""); setFormOpen(true); }
  function startEdit(item: Resource) { setEditing(item.id); setForm({ name: item.name, category: item.category, location: item.location, quantity: item.quantity, minimumStock: item.minimumStock, unit: item.unit }); setError(""); setFormOpen(true); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(editing, form); setFormOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the inventory item."); }
    finally { setBusy(false); }
  }
  return (
    <>
      <div className="page-title-row"><div><div className="eyebrow">HOSTEL OPERATIONS</div><h1>Resource inventory</h1><p>Monitor maintenance supplies and available stock.</p></div><div className="approval-actions"><div className="inventory-badge"><Package size={16}/>{resources.length} tracked items</div>{role === "Administrator" && <button className="button-primary" onClick={startCreate}><Plus size={16}/> Add item</button>}</div></div>
      {formOpen && <section className="panel settings-panel" style={{ marginBottom: 18 }}><h2>{editing ? "Edit inventory item" : "Add inventory item"}</h2><form className="modal-form" onSubmit={submit}><div className="form-grid"><label>Name<input required minLength={2} maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>Category<input required maxLength={60} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}/></label></div><div className="form-grid"><label>Location<input required maxLength={100} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}/></label><label>Unit<input required maxLength={24} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}/></label></div>{!editing && <label>Starting quantity<input type="number" min={0} max={100000} required value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })}/></label>}<label>Minimum stock<input type="number" min={0} max={100000} required value={form.minimumStock} onChange={e => setForm({ ...form, minimumStock: Number(e.target.value) })}/></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? "Saving…" : "Save item"}</button></div></form></section>}
      <section className="resource-grid">
        {resources.map((item) => {
          const low = item.quantity <= item.minimumStock;
          return <article className="resource-card" key={item.id}>
            <div className="resource-card-top"><div className="resource-illustration"><Package size={21}/></div><span className={`stock-status ${low ? "is-low" : "is-ok"}`}>{low ? "Low stock" : "In stock"}</span></div>
            <div className="resource-category">{item.category}</div><h3>{item.name}</h3><p className="resource-location">{item.location}</p>
            <div className="resource-count"><strong>{item.quantity}</strong><span>{item.unit} available</span></div>
            <div className="resource-progress"><span style={{width: `${Math.min(100, item.quantity / Math.max(item.minimumStock * 2, 1) * 100)}%`}}/></div>
            <div className="resource-footer"><span>Minimum: {item.minimumStock} {item.unit}</span>{role === "Administrator" && <div className="quantity-controls"><button onClick={() => onQuantity(item.id, Math.max(0, item.quantity - 1))} aria-label={`Decrease ${item.name}`}>−</button><button onClick={() => onQuantity(item.id, item.quantity + 1)} aria-label={`Increase ${item.name}`}>+</button></div>}</div>
            <div className="resource-actions">{role === "Administrator" && <button className="text-button" onClick={() => startEdit(item)}>Edit item</button>}{(role === "Administrator" || role === "Warden") && <button className="text-button" onClick={() => setHistoryId(item.id)}>Stock history</button>}</div>
          </article>;
        })}
      </section>
      {role !== "Administrator" && <div className="bottom-note"><ShieldCheck size={16}/><span>Inventory quantity changes are available in the Administrator view.</span></div>}
      {historyId && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setHistoryId(null); }}><section className="modal"><div className="modal-header"><div><div className="eyebrow">INVENTORY AUDIT</div><h2>Stock history</h2><p>{resources.find(item => item.id === historyId)?.name ?? "Inventory item"}</p></div><button className="icon-button" aria-label="Close history" onClick={() => setHistoryId(null)}><X size={18}/></button></div>{historyLoading ? <div className="empty-state">Loading stock history…</div> : historyError ? <div className="form-error" style={{ margin: 18 }}>{historyError}</div> : history.length ? history.map(item => <div className="detail-meta" style={{ margin: "0 22px" }} key={item.id}><span>{item.transactionType} · {item.quantity} {resources.find(resource => resource.id === historyId)?.unit} · {item.staffName ?? "System"}</span><strong>{dateLabel(item.createdAt)}</strong></div>) : <div className="empty-state">No stock transactions recorded.</div>}<div className="modal-actions"><button className="button-secondary" onClick={() => setHistoryId(null)}>Close</button></div></section></div>}
    </>
  );
}

function SettingsPage({ role, email, name, roomNumber, onNameChange, onRoomChange }: {
  role: Role; email: string; name: string; roomNumber: string;
  onNameChange: (value: string) => void; onRoomChange: (value: string) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setProfileBusy(true); setProfileMessage("");
    try {
      await api.updateStudentProfile({ fullName: name, roomNumber: role === "Student" ? roomNumber : "" });
      setProfileMessage("Profile saved.");
    } catch (e) { setProfileMessage(e instanceof Error ? e.message : "Could not save your profile."); }
    finally { setProfileBusy(false); }
  }
  async function savePassword(event: React.FormEvent) {
    event.preventDefault(); setPasswordBusy(true); setPasswordMessage("");
    if (newPassword.length < 8) { setPasswordMessage("Password must contain at least 8 characters."); setPasswordBusy(false); return; }
    if (newPassword !== confirmPassword) { setPasswordMessage("Passwords do not match."); setPasswordBusy(false); return; }
    if (!supabase) { setPasswordMessage("Supabase Auth is not configured."); setPasswordBusy(false); return; }
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(""); setConfirmPassword(""); setPasswordMessage("Password updated.");
    } catch (e) { setPasswordMessage(e instanceof Error ? e.message : "Could not update your password."); }
    finally { setPasswordBusy(false); }
  }
  return <>
    <div className="page-title-row"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>Settings</h1><p>Update your profile and sign-in password.</p></div></div>
    <div className="settings-grid">
      <section className="panel settings-panel"><h2>Profile details</h2><p>Changes are saved to your linked application profile.</p><form className="modal-form" onSubmit={saveProfile}><label>Email<input type="email" value={email} disabled readOnly/></label><label>Full name<input required minLength={2} maxLength={100} value={name} onChange={e => onNameChange(e.target.value)}/></label>{role === "Student" && <label>Room number<input required maxLength={30} value={roomNumber} onChange={e => onRoomChange(e.target.value)}/></label>}{profileMessage && <div className={profileMessage === "Profile saved." ? "auth-message" : "form-error"}>{profileMessage}</div>}<button className="button-primary" disabled={profileBusy}>{profileBusy ? "Saving…" : "Save profile"}</button></form></section>
      <section className="panel settings-panel"><h2>Change password</h2><p>Use at least 8 characters. Your password is sent directly to Supabase Auth over the signed-in session.</p><form className="modal-form" onSubmit={event => void savePassword(event)}><label>New password<input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label><label>Confirm password<input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}/></label>{passwordMessage && <div className={passwordMessage === "Password updated." ? "auth-message" : "form-error"}>{passwordMessage}</div>}<button className="button-primary" disabled={passwordBusy}>{passwordBusy ? "Updating…" : "Update password"}</button></form></section>
    </div>
  </>;
}

function AccountsPage({ requests, users, currentEmail, onRefresh }: {
  requests: Awaited<ReturnType<typeof api.accountRequests>>;
  users: Awaited<ReturnType<typeof api.accountUsers>>;
  currentEmail: string;
  onRefresh: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function review(id: string, decision: "Approved" | "Rejected") {
    const reason = decision === "Rejected" ? window.prompt("Optional reason to share with the applicant:") ?? undefined : undefined;
    if (decision === "Rejected" && reason === undefined) return;
    setBusyId(id); setError("");
    try { await api.reviewAccountRequest(id, decision, reason); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not review the application."); }
    finally { setBusyId(""); }
  }
  async function setActive(id: string, active: boolean) {
    if (!window.confirm(`${active ? "Activate" : "Deactivate"} this account?`)) return;
    setBusyId(id); setError("");
    try { await api.setAccountActive(id, active); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update account status."); }
    finally { setBusyId(""); }
  }
  const pending = requests.filter(request => request.status === "Pending");
  return <>
    <div className="page-title-row"><div><div className="eyebrow">ACCESS CONTROL</div><h1>Account applications</h1><p>Review staff access requests and manage account availability.</p></div><span className="small-count">{pending.length} pending</span></div>
    {error && <div className="alert"><AlertCircle size={17}/><span>{error}</span></div>}
    <section className="panel table-panel"><div className="table-toolbar"><div><h2>Pending applications <span className="table-total">{pending.length}</span></h2><p>Approval provisions the requested staff role in Supabase Auth.</p></div></div>
      {pending.length ? <div className="table-wrap"><table><thead><tr><th>APPLICANT</th><th>REQUESTED ROLE</th><th>SUBMITTED</th><th>ACTIONS</th></tr></thead><tbody>{pending.map(request => <tr key={request.id}><td><div className="table-person"><strong>{request.full_name}</strong><small>{request.email}</small></div></td><td>{request.requested_role}</td><td className="date-cell">{dateLabel(request.created_at)}</td><td><div className="approval-actions"><button className="button-primary" disabled={busyId === request.id} onClick={() => void review(request.id, "Approved")}>Approve</button><button className="button-secondary" disabled={busyId === request.id} onClick={() => void review(request.id, "Rejected")}>Reject</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state">There are no pending staff applications.</div>}
    </section>
    <section className="panel table-panel" style={{ marginTop: 18 }}><div className="table-toolbar"><div><h2>Accounts <span className="table-total">{users.length}</span></h2><p>Administrator roles are protected from status changes here.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>ACCOUNT</th><th>ROLE</th><th>EMAIL</th><th>LAST SIGN-IN</th><th>STATUS</th><th/></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><div className="table-person"><strong>{user.full_name || "No name set"}</strong><small>{user.email}</small></div></td><td>{user.role}</td><td><span className={`pill ${user.email_confirmed_at ? "status-resolved" : "status-submitted"}`}>{user.email_confirmed_at ? "Confirmed" : "Unconfirmed"}</span></td><td className="date-cell">{user.last_sign_in_at ? dateLabel(user.last_sign_in_at) : "Never"}</td><td><span className={`pill ${user.active ? "status-resolved" : "status-closed"}`}>{user.active ? "Active" : "Inactive"}</span></td><td>{user.role !== "Administrator" && user.email.toLowerCase() !== currentEmail.toLowerCase() && <button className="button-secondary" disabled={busyId === user.id} onClick={() => void setActive(user.id, !user.active)}>{user.active ? "Deactivate" : "Activate"}</button>}</td></tr>)}</tbody></table></div>
    </section>
  </>;
}

function RoomsPage({ rooms, canEdit, onRefresh }: { rooms: Room[]; canEdit: boolean; onRefresh: () => Promise<void> }) {
  const blank = { roomNumber: "", block: "", floor: null as number | null, capacity: 2, isAvailable: true };
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function edit(room: Room) { setEditingId(room.id); setForm({ roomNumber: room.roomNumber, block: room.block, floor: room.floor, capacity: room.capacity, isAvailable: room.isAvailable }); }
  function reset() { setEditingId(null); setForm(blank); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { if (editingId) await api.updateRoom(editingId, form); else await api.createRoom(form); reset(); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the room."); }
    finally { setBusy(false); }
  }
  async function remove(room: Room) {
    if (!window.confirm(`Delete room ${room.roomNumber}? Only an empty room can be deleted.`)) return;
    setBusy(true); setError("");
    try { await api.deleteRoom(room.id); await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete the room."); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-title-row"><div><div className="eyebrow">HOSTEL OPERATIONS</div><h1>Rooms</h1><p>Review occupancy, capacity, and room availability.</p></div><span className="inventory-badge"><DoorOpen size={16}/>{rooms.length} rooms</span></div>
    {error && <div className="alert"><AlertCircle size={17}/><span>{error}</span></div>}
    {canEdit && <section className="panel settings-panel" style={{ marginBottom: 18 }}><h2>{editingId ? "Edit room" : "Add a room"}</h2><p>Room identifiers must be unique. Capacity cannot be below occupancy.</p><form className="modal-form" onSubmit={save}>
      <div className="form-grid"><label>Room number<input required maxLength={30} value={form.roomNumber} onChange={e => setForm({ ...form, roomNumber: e.target.value })}/></label><label>Block<input required maxLength={60} value={form.block} onChange={e => setForm({ ...form, block: e.target.value })}/></label></div>
      <div className="form-grid"><label>Floor<input type="number" min={0} max={300} value={form.floor ?? ""} onChange={e => setForm({ ...form, floor: e.target.value === "" ? null : Number(e.target.value) })}/></label><label>Capacity<input type="number" required min={1} max={1000} value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })}/></label></div>
      <label><span><input type="checkbox" checked={form.isAvailable} onChange={e => setForm({ ...form, isAvailable: e.target.checked })}/> Room is available for assignment</span></label>
      <div className="modal-actions"><button type="button" className="button-secondary" onClick={reset}>Clear</button><button disabled={busy} className="button-primary" type="submit">{busy ? "Saving…" : editingId ? "Save changes" : "Add room"}</button></div>
    </form></section>}
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>ROOM</th><th>BLOCK / FLOOR</th><th>OCCUPANCY</th><th>AVAILABLE</th><th>STATUS</th>{canEdit && <th>ACTIONS</th>}</tr></thead><tbody>{rooms.map(room => <tr key={room.id}><td><strong>{room.roomNumber}</strong></td><td>{room.block} / {room.floor ?? "—"}</td><td>{room.occupiedCount} / {room.capacity}</td><td>{room.availableCount}</td><td><span className={`pill ${room.isAvailable ? "status-resolved" : "status-closed"}`}>{room.isAvailable ? "Available" : "Unavailable"}</span></td>{canEdit && <td><div className="approval-actions"><button className="button-secondary" onClick={() => edit(room)}>Edit</button><button className="button-secondary" disabled={busy || room.occupiedCount > 0} onClick={() => void remove(room)}>Delete</button></div></td>}</tr>)}</tbody></table></div>{rooms.length === 0 && <div className="empty-state">No rooms are configured.</div>}</section>
    {!canEdit && <div className="bottom-note"><ShieldCheck size={16}/><span>Room changes are restricted to Administrators.</span></div>}
  </>;
}

function ActivityPage({ activity }: { activity: SystemActivity[] }) {
  return <><div className="page-title-row"><div><div className="eyebrow">AUDIT TRAIL</div><h1>Activity history</h1><p>Recent system actions, with sensitive free-form details omitted.</p></div></div><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>ACTION</th><th>ENTITY</th><th>REFERENCE</th><th>WHEN</th></tr></thead><tbody>{activity.map(item => <tr key={item.id}><td><strong>{item.action}</strong></td><td>{item.entityType}</td><td>{item.entityId ?? "—"}</td><td className="date-cell">{dateLabel(item.createdAt)}</td></tr>)}</tbody></table></div>{activity.length === 0 && <div className="empty-state">No activity has been recorded.</div>}</section></>;
}

function CreateComplaintModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ category: "Electrical", title: "", description: "", priority: "Medium" as Complaint["priority"] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await api.createComplaint(form); await onCreated(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to create complaint."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal"><div className="modal-header"><div><div className="eyebrow">SERVICE REQUEST</div><h2>New complaint</h2><p>Tell us what needs attention in your hostel.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
      <form onSubmit={submit} className="modal-form">
        <div className="form-grid"><label>Category<select value={form.category} onChange={(e) => update("category", e.target.value)}><option>Electrical</option><option>Plumbing</option><option>Housekeeping</option><option>Furniture</option><option>Internet</option><option>Other</option></select></label><label>Priority<select value={form.priority} onChange={(e) => update("priority", e.target.value)}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label></div>
        <label>Complaint title<input required minLength={3} value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Briefly describe the issue"/></label>
        <label>Description<textarea required minLength={5} rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Add details that will help the maintenance team…"/></label>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button disabled={busy} className="button-primary" type="submit">{busy ? "Submitting…" : "Submit complaint"} <ArrowUpRight size={16}/></button></div>
      </form>
    </div>
  </div>;
}

function ComplaintModal({ complaint, role, onClose, onStatus, onAssign }: {
  complaint: Complaint; role: Role; onClose: () => void;
  onStatus: (id: string, status: ComplaintStatus, resolutionNotes?: string) => void; onAssign: (id: string, staff: string) => void;
}) {
  const [staff, setStaff] = useState<Awaited<ReturnType<typeof api.staff>>>([]);
  const [assignee, setAssignee] = useState("");
  const [staffError, setStaffError] = useState("");
  const [nextStatus, setNextStatus] = useState<ComplaintStatus>(complaint.status);
  const [resolutionNotes, setResolutionNotes] = useState(complaint.resolutionNotes ?? "");
  const [history, setHistory] = useState<ComplaintActivity[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void api.complaintActivity(complaint.id).then(data => { if (live) setHistory(data); })
      .catch(error => { if (live) setHistoryError(error instanceof Error ? error.message : "Could not load complaint history."); })
      .finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [complaint.id]);
  useEffect(() => {
    if (role !== "Warden" && role !== "Administrator") return;
    void api.staff().then(items => { setStaff(items); setAssignee(complaint.assignedTo ? items.find(item => item.full_name === complaint.assignedTo)?.id ?? "" : items[0]?.id ?? ""); })
      .catch(error => setStaffError(error instanceof Error ? error.message : "Could not load maintenance staff."));
  }, [complaint.assignedTo, role]);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal detail-modal"><div className="modal-header"><div><div className="eyebrow">{complaint.code}</div><h2>{complaint.title}</h2><p>{complaint.studentName} · Room {complaint.room} · {complaint.category}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
      <div className="detail-body"><div className="detail-badges"><StatusPill status={complaint.status}/><PriorityPill priority={complaint.priority}/></div><p className="detail-description">{complaint.description}</p><div className="detail-meta"><span>Submitted</span><strong>{dateLabel(complaint.createdAt)}</strong></div><div className="detail-meta"><span>Assigned staff</span><strong>{complaint.assignedTo ?? "Not assigned"}</strong></div>
        {(role === "Warden" || role === "Administrator") && <div className="management-controls"><label>Assign to<select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Select active maintenance staff</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><button className="button-secondary" disabled={!assignee || staff.length === 0} onClick={() => onAssign(complaint.id, assignee)}>Assign staff</button>{staffError && <div className="form-error">{staffError}</div>}{staff.length === 0 && !staffError && <small>No active Maintenance Staff accounts are available.</small>}</div>}
        {role !== "Student" && <div className="management-controls"><label>Update status<select value={nextStatus} onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)}>{statusOptions.filter(status => status === complaint.status || allowedStatusChanges(role, complaint.status).includes(status)).map((status) => <option key={status}>{status}</option>)}</select></label><button className="button-secondary" disabled={nextStatus === complaint.status || (nextStatus === "Resolved" && !resolutionNotes.trim())} onClick={() => onStatus(complaint.id, nextStatus, nextStatus === "Resolved" ? resolutionNotes : undefined)}>Save status</button></div>}
        {nextStatus === "Resolved" && role !== "Student" && <label className="status-control">Resolution notes<textarea rows={3} maxLength={2000} value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} placeholder="Describe the repair or resolution"/><small>A short resolution note is required before marking resolved.</small></label>}
        <div className="complaint-history"><h3>Activity history</h3>{historyLoading ? <small>Loading history…</small> : historyError ? <div className="form-error">{historyError}</div> : history.length ? history.map(item => <div className="detail-meta" key={item.id}><span>{item.action} · {item.actorName}</span><strong>{new Date(item.createdAt).toLocaleString()}</strong></div>) : <small>No history recorded.</small>}</div>
      </div><div className="modal-actions"><button className="button-secondary" onClick={onClose}>Close details</button></div>
    </div>
  </div>;
}

function allowedStatusChanges(role: Role, current: ComplaintStatus): ComplaintStatus[] {
  const transitions: Record<ComplaintStatus, ComplaintStatus[]> = {
    Submitted: ["Reviewed", "Assigned"], Reviewed: ["Assigned", "In Progress"], Assigned: ["In Progress"],
    "In Progress": ["Resolved"], Resolved: ["Closed", "In Progress"], Closed: []
  };
  return role === "Maintenance Staff" ? transitions[current].filter(status => status === "In Progress" || status === "Resolved") : transitions[current];
}
