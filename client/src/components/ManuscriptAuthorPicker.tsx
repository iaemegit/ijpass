import { useState, type KeyboardEvent } from "react";
import { api } from "../lib/auth";

type Affiliation = {
  id: number;
  name: string;
  country: string | null;
  designations: string[];
  startYear: number | null;
  endYear: number | null;
  papers: number;
};

type SearchAuthor = {
  id: number;
  salutation: string | null;
  authorName: string;
  email: string | null;
  orcid: string | null;
  affiliation: string | null;
  country: string | null;
  articleCount: number;
  affiliations?: Affiliation[];
};

type AuthorDetail = SearchAuthor & { affiliations: Affiliation[] };

export type ManuscriptAuthorAssignment = {
  authorProfileId: number;
  affiliationId: number;
  authorDataId?: number;
  salutation: string | null;
  name: string;
  affiliation: string;
  country: string | null;
  designation: string;
};

export default function ManuscriptAuthorPicker({ value, onChange }: {
  value: ManuscriptAuthorAssignment[];
  onChange: (authors: ManuscriptAuthorAssignment[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchAuthor[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedAffiliationId, setSelectedAffiliationId] = useState<number | null>(null);

  const closeSearchModal = () => setSearchModalOpen(false);
  const closeDetailModal = () => {
    setDetailModalOpen(false);
    setDetail(null);
    setSelectedAffiliationId(null);
  };

  const search = async () => {
    const authorName = query.trim();
    if (authorName.length < 2) {
      setError("Enter at least two characters of the author name.");
      return;
    }

    setSearching(true);
    setError("");
    setResults([]);
    setTotalResults(0);
    setSearchModalOpen(true);
    setDetailModalOpen(false);

    try {
      const { data } = await api.get<{ profiles: SearchAuthor[]; totalRecords: number }>("/admin/author-profiles", {
        params: { q: authorName, page: 1, sort: "name" },
      });
      setResults(Array.isArray(data.profiles) ? data.profiles : []);
      setTotalResults(Number(data.totalRecords) || data.profiles?.length || 0);
    } catch {
      setError("Unable to search author profiles. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const viewAuthor = async (authorId: number) => {
    setSearchModalOpen(false);
    setDetailModalOpen(true);
    setDetail(null);
    setSelectedAffiliationId(null);
    setDetailLoading(true);
    setError("");

    try {
      const { data } = await api.get<{ profile: AuthorDetail }>(`/admin/author-profiles/${authorId}`);
      setDetail(data.profile);
      setSelectedAffiliationId(data.profile.affiliations[0]?.id ?? null);
    } catch {
      setError("Unable to load this author profile.");
    } finally {
      setDetailLoading(false);
    }
  };

  const backToResults = () => {
    closeDetailModal();
    setError("");
    setSearchModalOpen(true);
  };

  const addAuthor = () => {
    if (!detail || !selectedAffiliationId) return;
    const affiliation = detail.affiliations.find((item) => item.id === selectedAffiliationId);
    if (!affiliation) return;

    const assignment: ManuscriptAuthorAssignment = {
      authorProfileId: detail.id,
      affiliationId: affiliation.id,
      salutation: detail.salutation,
      name: detail.authorName,
      affiliation: affiliation.name,
      country: affiliation.country,
      designation: affiliation.designations?.[0] || "",
    };

    onChange(value.some((item) => item.authorProfileId === detail.id)
      ? value.map((item) => item.authorProfileId === detail.id ? assignment : item)
      : [...value, assignment]);
    closeDetailModal();
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const multipleAffiliations = (detail?.affiliations.length ?? 0) > 1;

  return <div className="manuscript-author-picker">
    <div className="manuscript-author-picker-head">
      <div><i className="bi bi-people-fill"/><span><b>Author Details</b><small>Search author profiles, review their data, and select an affiliation.</small></span></div>
      <span className="badge">{value.length} added</span>
    </div>

    <div className="manuscript-author-search">
      <div><i className="bi bi-search"/><input className="form-control" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Search author by name" autoComplete="off"/></div>
      <button type="button" className="btn btn-primary" disabled={searching} onClick={() => void search()}>{searching ? <span className="spinner-border spinner-border-sm"/> : <i className="bi bi-search me-2"/>}Search</button>
    </div>
    {!searchModalOpen && !detailModalOpen && error && <div className="alert alert-danger py-2 mb-2">{error}</div>}

    {value.length > 0 && <div className="manuscript-assigned-authors">
      <h4>Authors added to manuscript</h4>
      {value.map((author, index) => <div key={author.authorProfileId}>
        <span className="author-order">{index + 1}</span>
        <span className="author-assignment-name">
          <b>{[author.salutation, author.name].filter(Boolean).join(" ")}</b>
          <small>Author ID {author.authorProfileId} - Affiliation ID {author.affiliationId}</small>
          <em>{author.affiliation}{author.designation ? ` - ${author.designation}` : ""}</em>
        </span>
        {index === 0 && <span className="primary-author-badge">Primary</span>}
        <div className="author-assignment-actions">
          <button type="button" title="Move up" disabled={index === 0} onClick={() => move(index, -1)}><i className="bi bi-arrow-up"/></button>
          <button type="button" title="Move down" disabled={index === value.length - 1} onClick={() => move(index, 1)}><i className="bi bi-arrow-down"/></button>
          <button type="button" title="Remove author" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><i className="bi bi-trash3"/></button>
        </div>
      </div>)}
    </div>}

    {searchModalOpen && <div className="author-picker-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSearchModal(); }}>
      <div className="author-picker-modal author-picker-results-modal" role="dialog" aria-modal="true" aria-labelledby="author-search-results-title">
        <div className="author-picker-modal-head">
          <div><small>Author search</small><h3 id="author-search-results-title">Results for "{query.trim()}"</h3></div>
          <button type="button" onClick={closeSearchModal} aria-label="Close"><i className="bi bi-x-lg"/></button>
        </div>
        <div className="author-picker-search-results">
          {searching ? <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Searching authors...</div>
            : error ? <div className="alert alert-danger mb-0">{error}</div>
              : results.length ? <>
                <div className="author-search-result-count"><i className="bi bi-people me-2"/>{totalResults} matching profile{totalResults === 1 ? "" : "s"} found</div>
                <div className="table-responsive author-search-results-table-wrap">
                  <table className="table table-hover align-middle mb-0 author-search-results-table">
                    <thead><tr><th>Author</th><th>Affiliation</th><th>Country</th><th className="text-center">Papers</th><th className="text-end">Action</th></tr></thead>
                    <tbody>{results.map((author) => <tr key={author.id}>
                      <td><strong>{[author.salutation, author.authorName].filter(Boolean).join(" ")}</strong><small>Author ID {author.id}</small></td>
                      <td>{author.affiliations?.length ? <div className="author-result-affiliations">{author.affiliations.map((affiliation) => <span key={affiliation.id}><b>{affiliation.name}</b><small>Affiliation ID {affiliation.id}{affiliation.designations.length ? ` - ${affiliation.designations.join(", ")}` : ""}</small></span>)}</div> : author.affiliation || "Affiliation unavailable"}</td>
                      <td>{author.affiliations?.length ? [...new Set(author.affiliations.map((affiliation) => affiliation.country).filter(Boolean))].join(", ") || "-" : author.country || "-"}</td>
                      <td className="text-center">{author.articleCount}</td>
                      <td className="text-end"><button type="button" className="btn btn-sm btn-primary" onClick={() => void viewAuthor(author.id)}><i className="bi bi-eye me-1"/>View details</button></td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </> : <div className="text-center text-muted py-4"><i className="bi bi-person-x fs-3 d-block mb-2"/>No matching author profiles found.</div>}
        </div>
        <div className="author-picker-modal-actions"><button type="button" className="btn btn-outline-secondary" onClick={closeSearchModal}>Close</button></div>
      </div>
    </div>}

    {detailModalOpen && <div className="author-picker-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetailModal(); }}>
      <div className="author-picker-modal" role="dialog" aria-modal="true" aria-labelledby="author-detail-title">
        {detailLoading ? <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2"/>Loading complete author details...</div>
          : error ? <><div className="author-picker-modal-head"><div><small>Author details</small><h3 id="author-detail-title">Unable to load profile</h3></div><button type="button" onClick={closeDetailModal} aria-label="Close"><i className="bi bi-x-lg"/></button></div><div className="alert alert-danger m-3">{error}</div><div className="author-picker-modal-actions"><button type="button" className="btn btn-outline-secondary" onClick={backToResults}>Back to results</button></div></>
            : detail && <>
              <div className="author-picker-modal-head">
                <div><small>Author ID {detail.id}</small><h3 id="author-detail-title">{[detail.salutation, detail.authorName].filter(Boolean).join(" ")}</h3></div>
                <button type="button" onClick={closeDetailModal} aria-label="Close"><i className="bi bi-x-lg"/></button>
              </div>
              <div className="author-picker-profile-meta">
                <span><i className="bi bi-envelope"/><b>Email</b><small>{detail.email || "Email unavailable"}</small></span>
                <span><i className="bi bi-person-badge"/><b>ORCID</b><small>{detail.orcid || "ORCID unavailable"}</small></span>
                <span><i className="bi bi-file-earmark-text"/><b>Papers published</b><small>{detail.articleCount}</small></span>
              </div>
              <div className="author-picker-affiliations">
                <h4>{multipleAffiliations ? "Select an affiliation" : "Affiliation"}</h4>
                {detail.affiliations.length ? detail.affiliations.map((affiliation) => <label className={`${selectedAffiliationId === affiliation.id ? "selected" : ""}${multipleAffiliations ? "" : " single-affiliation"}`} key={affiliation.id}>
                  {multipleAffiliations && <input type="radio" name="author-affiliation" checked={selectedAffiliationId === affiliation.id} onChange={() => setSelectedAffiliationId(affiliation.id)}/>}
                  <span><b>{affiliation.name}</b>{affiliation.designations?.map((designation) => <em key={designation}>{designation}</em>)}<small>Affiliation ID {affiliation.id}{affiliation.country ? ` - ${affiliation.country}` : ""} - {affiliation.startYear && affiliation.endYear ? `${affiliation.startYear}-${affiliation.endYear}` : "Period unavailable"}</small></span>
                  <strong>{affiliation.papers} paper{affiliation.papers === 1 ? "" : "s"}</strong>
                </label>) : <div className="alert alert-warning">No affiliation is linked to this author. Add an affiliation in the author profile before assigning this author.</div>}
              </div>
              <div className="author-picker-modal-actions">
                <button type="button" className="btn btn-outline-secondary me-auto" onClick={backToResults}><i className="bi bi-arrow-left me-2"/>Back to results</button>
                <button type="button" className="btn btn-outline-secondary" onClick={closeDetailModal}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={!selectedAffiliationId} onClick={addAuthor}><i className="bi bi-person-plus me-2"/>{value.some((item) => item.authorProfileId === detail.id) ? "Update Author" : "Add to Manuscript"}</button>
              </div>
            </>}
      </div>
    </div>}
  </div>;
}
