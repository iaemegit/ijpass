import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/auth";
import AdminPagination from "./AdminPagination";
import AdminTableControls from "./AdminTableControls";

type MergeProfile = {
  id: number;
  salutation: string | null;
  name: string;
  email: string | null;
  orcid: string | null;
  papers: number;
  affiliations: Array<{ id: number; name: string; country: string | null; designations: string[]; startYear: number | null; endYear: number | null; papers: number }>;
};
type MergeRequest = {
  id: number;
  reference: string;
  requestedName: string;
  authorIds: number[];
  profileCount?: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  canonicalAuthorId: number | null;
  createdAt: string;
  reviewedAt: string | null;
  profiles?: MergeProfile[];
};

const statusClass = (status: MergeRequest["status"]) => status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning";
const affiliationPeriod = (affiliation: MergeProfile["affiliations"][number]) =>
  affiliation.startYear && affiliation.endYear
    ? `${affiliation.startYear}–${affiliation.endYear}`
    : affiliation.startYear
      ? `From ${affiliation.startYear}`
      : affiliation.endYear
        ? `Until ${affiliation.endYear}`
        : "Period unavailable";

export default function AuthorMergeRequestManager() {
  const navigate = useNavigate(), location = useLocation();
  const detailId = Number(location.pathname.match(/author-merge-requests\/(\d+)/)?.[1] || 0);
  const [requests, setRequests] = useState<MergeRequest[]>([]), [request, setRequest] = useState<MergeRequest | null>(null),
    [selectedIds, setSelectedIds] = useState<number[]>([]), [canonicalAuthorId, setCanonicalAuthorId] = useState<number | null>(null), [page, setPage] = useState(1), [totalRecords, setTotalRecords] = useState(0),
    [query, setQuery] = useState(""), [loading, setLoading] = useState(true), [approving, setApproving] = useState(false),
    [error, setError] = useState(""), [notice, setNotice] = useState("");

  const loadList = useCallback(() => {
    setLoading(true); setError("");
    return api.get<{ requests: MergeRequest[]; totalRecords: number }>("/admin/author-merge-requests", { params: { q: query || undefined, page } })
      .then(({ data }) => { setRequests(data.requests); setTotalRecords(data.totalRecords); })
      .catch(() => setError("Unable to load author merge requests."))
      .finally(() => setLoading(false));
  }, [page, query]);

  useEffect(() => {
    if (!detailId) { void loadList(); return; }
    setLoading(true); setError("");
    api.get<{ request: MergeRequest }>(`/admin/author-merge-requests/${detailId}`)
      .then(({ data }) => { const ids=data.request.status === "PENDING" ? data.request.authorIds : [];setRequest(data.request);setSelectedIds(ids);setCanonicalAuthorId(ids.length?Math.min(...ids):data.request.canonicalAuthorId); })
      .catch(() => setError("Unable to load this author merge request."))
      .finally(() => setLoading(false));
  }, [detailId, loadList]);

  const toggleProfile = (authorId: number) => {
    setSelectedIds((current) => {
      const next = current.includes(authorId) ? current.filter((id) => id !== authorId) : [...current, authorId];
      if (!canonicalAuthorId || !next.includes(canonicalAuthorId)) setCanonicalAuthorId(next.length ? Math.min(...next) : null);
      return next;
    });
  };

  const approve = async () => {
    if (!request || selectedIds.length < 2) { setError("Select at least two author profiles to merge."); return; }
    if (!canonicalAuthorId || !selectedIds.includes(canonicalAuthorId)) { setError("Select the destination Author ID."); return; }
    if (!window.confirm(`Approve this request and merge ${selectedIds.length} profiles into Author ID ${canonicalAuthorId}?`)) return;
    setApproving(true); setError(""); setNotice("");
    try {
      const { data } = await api.post<{ message: string }>(`/admin/author-merge-requests/${request.id}/approve`, { authorIds: selectedIds, canonicalAuthorId });
      setNotice(data.message);
      const refreshed = await api.get<{ request: MergeRequest }>(`/admin/author-merge-requests/${request.id}`);
      setRequest(refreshed.data.request); setSelectedIds([]);setCanonicalAuthorId(refreshed.data.request.canonicalAuthorId);
    } catch (requestError) {
      setError((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || "Unable to approve this merge request.");
    } finally { setApproving(false); }
  };

  if (detailId) return <section>
    <div className="manager-heading"><div><span className="eyebrow">Super Admin review</span><h2>Author Merge Request</h2><p>Review every author identity and manuscript count before approving the merge.</p></div><button className="btn btn-outline-secondary" onClick={() => navigate("/admin/author-merge-requests")}><i className="bi bi-arrow-left me-2"/>Back to requests</button></div>
    {error && <div className="alert alert-danger">{error}</div>}{notice && <div className="alert alert-success">{notice}</div>}
    {loading ? <div className="admin-form-card text-center py-5"><span className="spinner-border spinner-border-sm me-2"/>Loading request…</div> : request && <div className="admin-form-card author-merge-review">
      <div className="author-merge-review-head"><div><small>Request reference</small><h3>{request.reference}</h3><p>{request.requestedName} · Submitted {new Date(request.createdAt).toLocaleString()}</p></div><span className={`badge text-bg-${statusClass(request.status)}`}>{request.status}</span></div>
      <div className="alert alert-info"><i className="bi bi-info-circle-fill me-2"/>Select the profiles to merge and choose which selected Author ID will remain as the destination. Manuscript authorship, author order, source mappings, and affiliations are preserved.</div>
      {request.status === "PENDING" && selectedIds.length > 0 && <div className="author-merge-target author-merge-target-select"><span><i className="bi bi-sign-merge-right"/>Merge destination</span><select className="form-select" value={canonicalAuthorId??""} onChange={(event)=>setCanonicalAuthorId(Number(event.target.value)||null)}><option value="">Select destination Author ID</option>{selectedIds.slice().sort((a,b)=>a-b).map((authorId)=>{const profile=request.profiles?.find((item)=>item.id===authorId);return <option key={authorId} value={authorId}>Author ID {authorId}{profile?` - ${[profile.salutation,profile.name].filter(Boolean).join(" ")}`:""}</option>})}</select><small>The selected destination profile will remain after the merge.</small></div>}
      {request.status === "APPROVED" && request.canonicalAuthorId && <div className="author-merge-target approved"><span><i className="bi bi-check-circle-fill"/>Merged into</span><strong>Author ID {request.canonicalAuthorId}</strong><small>Canonical author profile</small></div>}
      <div className="table-responsive"><table className="table align-middle author-merge-review-table"><thead><tr><th className="text-center">Select</th><th>Author ID</th><th>Name</th><th>Affiliations</th><th className="text-center">Papers</th></tr></thead><tbody>{request.authorIds.map((authorId) => {
        const profile = request.profiles?.find((item) => item.id === authorId), checked = selectedIds.includes(authorId);
        return <tr key={authorId} className={checked ? "table-active" : ""}><td className="text-center"><input className="form-check-input" type="checkbox" checked={checked} disabled={request.status !== "PENDING" || !profile} onChange={() => toggleProfile(authorId)}/></td><td><code>{authorId}</code>{request.canonicalAuthorId === authorId && <small className="d-block text-success">Canonical author</small>}{request.status==="PENDING"&&canonicalAuthorId===authorId&&<small className="d-block text-primary">Merge destination</small>}</td><td><b>{profile ? [profile.salutation, profile.name].filter(Boolean).join(" ") : request.requestedName}</b>{!profile && <small className="d-block text-muted">Merged profile removed</small>}</td><td>{profile?.affiliations.length ? profile.affiliations.map((affiliation) => <div className="merge-affiliation" key={affiliation.id}><span>{affiliation.name}{affiliation.country ? `, ${affiliation.country}` : ""}{affiliation.designations?.map((designation) => <i key={designation}>{designation}</i>)}<em>({affiliationPeriod(affiliation)})</em></span><small>{affiliation.papers} paper{affiliation.papers === 1 ? "" : "s"}</small></div>) : "—"}</td><td className="text-center"><b>{profile?.papers ?? "—"}</b></td></tr>;
      })}</tbody></table></div>
      {request.status === "PENDING" && <div className="author-merge-approval"><span>{selectedIds.length} of {request.authorIds.length} profiles selected</span><button className="btn btn-primary" disabled={selectedIds.length < 2 || approving} onClick={approve}>{approving ? <><span className="spinner-border spinner-border-sm me-2"/>Merging…</> : <><i className="bi bi-check2-circle me-2"/>Approve & Merge</>}</button></div>}
    </div>}
  </section>;

  return <section><div className="manager-heading"><div><span className="eyebrow">Super Admin records</span><h2>Author Merge Requests</h2><p>Review merge suggestions submitted from indexed author search results.</p></div></div>
    <div className="users-table-card"><div className="table-title admin-list-title"><h3>Merge Request List</h3><AdminTableControls query={query} onQueryChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search reference, author name, status" sort="newest" onSortChange={() => undefined} options={[{ value: "newest", label: "Newest first" }]}/><span>{totalRecords.toLocaleString()} requests</span></div>
      {error && <div className="alert alert-danger m-3">{error}</div>}<div className="table-responsive"><table className="table align-middle"><thead><tr><th>Reference</th><th>Author Name</th><th className="text-center">Profiles</th><th>Status</th><th>Submitted</th><th>View</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="text-center py-4">Loading requests…</td></tr> : requests.map((item) => <tr key={item.id}><td><code>{item.reference}</code></td><td><b>{item.requestedName}</b><small>IDs: {item.authorIds.join(", ")}</small></td><td className="text-center">{item.profileCount}</td><td><span className={`badge text-bg-${statusClass(item.status)}`}>{item.status}</span></td><td>{new Date(item.createdAt).toLocaleString()}</td><td><button className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/admin/author-merge-requests/${item.id}`)} title="View merge request"><i className="bi bi-eye me-1"/>View</button></td></tr>)}{!loading && !requests.length && <tr><td colSpan={6} className="text-center text-muted py-4">No author merge requests found.</td></tr>}</tbody></table></div><AdminPagination total={totalRecords} page={page} onPageChange={setPage}/></div>
  </section>;
}
