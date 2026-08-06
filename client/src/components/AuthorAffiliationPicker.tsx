import { useState, type KeyboardEvent } from "react";
import { api } from "../lib/auth";

export type SelectedAuthorAffiliation = {
  id: number;
  name: string;
  address: string;
  country: string;
};

type AffiliationResult = {
  id: number;
  universityCompany: string;
  address: string;
  country: string;
  authorCount: number;
};

export default function AuthorAffiliationPicker({ value, onChange }: {
  value: SelectedAuthorAffiliation[];
  onChange: (value: SelectedAuthorAffiliation[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AffiliationResult[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    const phrase = query.trim();
    if (phrase.length < 2) {
      setError("Enter at least two characters of the affiliation name.");
      return;
    }
    setOpen(true);
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const { data } = await api.get<{ profiles: AffiliationResult[]; totalRecords: number }>("/admin/affiliation-profiles", {
        params: { q: phrase, page: 1, sort: "name" },
      });
      setResults(Array.isArray(data.profiles) ? data.profiles : []);
      setTotal(Number(data.totalRecords) || data.profiles?.length || 0);
    } catch {
      setError("Unable to search affiliation profiles.");
    } finally {
      setLoading(false);
    }
  };

  const select = (affiliation: AffiliationResult) => {
    const selected = { id: affiliation.id, name: affiliation.universityCompany, address: affiliation.address, country: affiliation.country };
    if (!value.some((item) => item.id === selected.id)) onChange([...value, selected]);
    setOpen(false);
  };

  return <div className="author-affiliation-picker">
    <label>Affiliations <span className="text-danger">*</span></label>
    <div className="manuscript-author-search mb-2">
      <div><i className="bi bi-search"/><input className="form-control" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Search university, institution, or company" autoComplete="off"/></div>
      <button type="button" className="btn btn-primary" onClick={() => void search()} disabled={loading}><i className="bi bi-search me-2"/>Search</button>
    </div>
    {!open && error && <div className="invalid-feedback d-block">{error}</div>}
    {value.length > 0 && <div className="selected-author-affiliations">{value.map((affiliation) => <div className="selected-author-affiliation" key={affiliation.id}>
      <i className="bi bi-building-check"/>
      <span><b>{affiliation.name}</b><small>Affiliation ID {affiliation.id}{affiliation.country ? ` - ${affiliation.country}` : ""}</small>{affiliation.address && <em>{affiliation.address}</em>}</span>
      <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onChange(value.filter((item) => item.id !== affiliation.id))}><i className="bi bi-trash3 me-1"/>Remove</button>
    </div>)}</div>}

    {open && <div className="author-picker-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="author-picker-modal author-picker-results-modal" role="dialog" aria-modal="true" aria-labelledby="affiliation-search-title">
        <div className="author-picker-modal-head"><div><small>Affiliation search</small><h3 id="affiliation-search-title">Results for "{query.trim()}"</h3></div><button type="button" onClick={() => setOpen(false)} aria-label="Close"><i className="bi bi-x-lg"/></button></div>
        <div className="author-picker-search-results">
          {loading ? <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Searching affiliations...</div>
            : error ? <div className="alert alert-danger mb-0">{error}</div>
              : results.length ? <><div className="author-search-result-count"><i className="bi bi-buildings me-2"/>{total} matching affiliation{total === 1 ? "" : "s"} found</div><div className="table-responsive author-search-results-table-wrap"><table className="table table-hover align-middle mb-0 author-search-results-table"><thead><tr><th>Affiliation</th><th>Address</th><th>Country</th><th className="text-end">Action</th></tr></thead><tbody>{results.map((affiliation) => <tr key={affiliation.id}><td><strong>{affiliation.universityCompany}</strong><small>Affiliation ID {affiliation.id}</small></td><td>{affiliation.address || "-"}</td><td>{affiliation.country || "-"}</td><td className="text-end"><button type="button" className="btn btn-sm btn-primary" onClick={() => select(affiliation)}><i className="bi bi-check2 me-1"/>Select</button></td></tr>)}</tbody></table></div></>
                : <div className="text-center text-muted py-4"><i className="bi bi-building-x fs-3 d-block mb-2"/>No matching affiliation profiles found.</div>}
        </div>
        <div className="author-picker-modal-actions"><button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>Close</button></div>
      </div>
    </div>}
  </div>;
}
