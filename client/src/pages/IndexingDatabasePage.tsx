import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/auth";
import { toArticleTitleCase } from "../lib/text";
import "./IndexingDatabasePage.css";

type Kind = "resources" | "authors" | "affiliations" | "countries";
type Pagination = {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
};
type Resource = {
  id: number;
  title: string;
  abbreviation: string | null;
  publisher: string | null;
  citeMetrixScore: number;
  percentile: number;
  citations: number;
  papers: number;
  citedPercent: number;
  hIndex: number;
  i10Index: number;
};
type Author = {
  id: number;
  salutation: string | null;
  name: string;
  orcid: string | null;
  affiliation: string | null;
  country: string | null;
  papers: number;
  hIndex: number;
  i10Index: number;
  affiliations: Array<{ id: number; name: string; country: string | null; designations: string[]; startYear: number | null; endYear: number | null; papers: number }>;
};
type Affiliation = {
  id: number;
  name: string;
  address: string;
  country: string;
  authors: number;
  papers: number;
  citations: number;
  hIndex: number;
  i10Index: number;
};
type Country = {
  country: string;
  affiliations: number;
  authors: number;
  papers: number;
  hIndex: number;
  i10Index: number;
};
const initialPagination: Pagination = {
  page: 1,
  pageSize: 20,
  totalRecords: 0,
  totalPages: 1,
};
const previousYear = new Date().getFullYear();
const metricYears = Array.from(
  { length: previousYear - 2017 },
  (_, index) => previousYear - index,
);
const labels = {
  resources: {
    title: "Resources",
    icon: "bi-collection",
    text: "Search indexed journals, book series, conference proceedings, and scholarly resources.",
  },
  authors: {
    title: "Authors",
    icon: "bi-people",
    text: "Discover author profiles represented in the IJPAss indexing database.",
  },
  affiliations: {
    title: "Affiliation",
    icon: "bi-buildings",
    text: "Explore universities, institutions, companies, and research affiliations.",
  },
  countries: {
    title: "Country",
    icon: "bi-globe2",
    text: "Review indexed research participation and publishing activity by country.",
  },
};

export default function IndexingDatabasePage({ kind }: { kind: Kind }) {
  const resourceTableRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(""),
    [debouncedQuery, setDebouncedQuery] = useState(""),
    [page, setPage] = useState(1),
    [pagination, setPagination] = useState(initialPagination),
    [records, setRecords] = useState<
      Array<Resource | Author | Affiliation | Country>
    >([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [field, setField] = useState("resourceTitle"),
    [types, setTypes] = useState<string[]>([]),
    [draftTypes, setDraftTypes] = useState<string[]>([]),
    [filterYear, setFilterYear] = useState(""),
    [appliedYear, setAppliedYear] = useState(""),
    [metricYear, setMetricYear] = useState(previousYear),
    [showCmsInfo, setShowCmsInfo] = useState(false),
    [scrollAtEnd, setScrollAtEnd] = useState(false),
    [suggestions, setSuggestions] = useState<string[]>([]),
    [suggestionsEnabled, setSuggestionsEnabled] = useState(true),
    [hasSearched, setHasSearched] = useState(false),
    [showAdvancedSearch, setShowAdvancedSearch] = useState(false),
    [countryQuery, setCountryQuery] = useState(""),
    [countrySuggestions, setCountrySuggestions] = useState<string[]>([]),
    [countrySuggestionsEnabled, setCountrySuggestionsEnabled] = useState(true),
    [submittedCountry, setSubmittedCountry] = useState(""),
    [selectedAuthorIds, setSelectedAuthorIds] = useState<number[]>([]),
    [selectedAffiliationIds, setSelectedAffiliationIds] = useState<number[]>([]),
    [mergeSubmitting, setMergeSubmitting] = useState(false),
    [mergeNotice, setMergeNotice] = useState(""),
    [mergeError, setMergeError] = useState("");
  useEffect(() => {
    setQuery("");
    setDebouncedQuery("");
    setPage(1);
    setRecords([]);
    setTypes([]);
    setDraftTypes([]);
    setFilterYear("");
    setAppliedYear("");
    setHasSearched(false);
    setShowAdvancedSearch(false);
    setCountryQuery("");
    setCountrySuggestions([]);
    setSubmittedCountry("");
    setSelectedAuthorIds([]);
    setSelectedAffiliationIds([]);
    setMergeNotice("");
    setMergeError("");
  }, [kind]);
  useEffect(() => {
    if ((kind === "authors" || kind === "affiliations" || kind === "countries") && !hasSearched) {
      setRecords([]);
      setPagination(initialPagination);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api
      .get(`/indexing/${kind}`, {
        params: {
          q: debouncedQuery || undefined,
          page,
          field: kind === "resources" ? field : undefined,
          types:
            kind === "resources" && types.length ? types.join(",") : undefined,
          year: kind === "resources" ? metricYear : undefined,
          publicationYear: kind === "resources" && appliedYear ? appliedYear : undefined,
          country: kind === "authors" && submittedCountry ? submittedCountry : undefined,
        },
        signal: controller.signal,
      })
      .then(({ data }) => {
        setRecords(data[kind]);
        setPagination(data.pagination);
        if (data.pagination.page !== page) setPage(data.pagination.page);
      })
      .catch((requestError) => {
        if (requestError.code !== "ERR_CANCELED")
          setError(
            "The indexing database could not be loaded. Please try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedYear, debouncedQuery, field, hasSearched, kind, metricYear, page, submittedCountry, types]);
  useEffect(() => {
    if (
      !suggestionsEnabled ||
      query.trim().length < 2
    ) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController(),
      timer = window.setTimeout(
        () =>
          api
            .get(`/indexing/${kind}/suggestions`, {
              params: { q: query.trim(), field: kind === "resources" ? field : undefined },
              signal: controller.signal,
            })
            .then(({ data }) => setSuggestions(data.suggestions || []))
            .catch(() => setSuggestions([])),
        220,
      );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [field, kind, query, suggestionsEnabled]);
  useEffect(() => {
    if (kind !== "authors" || !countrySuggestionsEnabled || countryQuery.trim().length < 2) {
      setCountrySuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.get("/indexing/countries/suggestions", {
        params: { q: countryQuery.trim() },
        signal: controller.signal,
      }).then(({ data }) => setCountrySuggestions(data.suggestions || []))
        .catch(() => setCountrySuggestions([]));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [countryQuery, countrySuggestionsEnabled, kind]);
  const toggleType = (value: string) => {
    setDraftTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  };
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((kind === "authors" || kind === "affiliations" || kind === "countries") && !query.trim() && !countryQuery.trim()) return;
    setSuggestionsEnabled(false);
    setSuggestions([]);
    setCountrySuggestionsEnabled(false);
    setCountrySuggestions([]);
    setDebouncedQuery(query.trim());
    if (kind === "authors") {
      setSubmittedCountry(countryQuery.trim());
      setHasSearched(true);
    } else if (kind === "affiliations" || kind === "countries") setHasSearched(true);
    setPage(1);
  };
  const toggleAuthorSelection = (authorId: number) => {
    setSelectedAuthorIds((current) => current.includes(authorId)
      ? current.filter((id) => id !== authorId)
      : [...current, authorId]);
    setMergeNotice("");
    setMergeError("");
  };
  const toggleAffiliationSelection = (affiliationId: number) => {
    setSelectedAffiliationIds((current) => current.includes(affiliationId)
      ? current.filter((id) => id !== affiliationId)
      : [...current, affiliationId]);
    setMergeNotice("");
    setMergeError("");
  };
  const submitMergeRequest = async () => {
    const selectedIds = kind === "affiliations" ? selectedAffiliationIds : selectedAuthorIds;
    if (selectedIds.length < 2) {
      setMergeError(`Select at least two ${kind === "affiliations" ? "affiliation" : "author"} profiles to request a merge.`);
      return;
    }
    setMergeSubmitting(true);
    setMergeError("");
    setMergeNotice("");
    try {
      const { data } = await api.post<{ message: string; reference: string }>(
        `/indexing/${kind === "affiliations" ? "affiliations" : "authors"}/merge-requests`,
        kind === "affiliations" ? { affiliationIds: selectedIds } : { authorIds: selectedIds },
      );
      setMergeNotice(`${data.message} Reference: ${data.reference}`);
      if (kind === "affiliations") setSelectedAffiliationIds([]); else setSelectedAuthorIds([]);
    } catch (requestError) {
      setMergeError((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || "Unable to submit the merge request.");
    } finally {
      setMergeSubmitting(false);
    }
  };
  const copy = labels[kind];
  const formatSuggestion = (value: string) =>
    kind === "resources" && (field === "resourceTitle" || field === "manuscriptTitle")
      ? toArticleTitleCase(value)
      : value;
  return (
    <>
      <section className="page-hero indexing-hero">
        <div className="container">
          <div className="breadcrumb-line">
            <Link to="/">Home</Link>
            <i className="bi bi-chevron-right" />
            <Link to="/indexing-db/resources">Indexing DB</Link>
            <i className="bi bi-chevron-right" />
            <span>{copy.title}</span>
          </div>
          <span className="eyebrow-light">IJPAss scholarly database</span>
          <h1>{copy.title}</h1>
          <p>{copy.text}</p>
        </div>
      </section>
      <section className="section-space indexing-page">
        <div className="container">
          <div className="indexing-heading">
            <div>
              <span className="eyebrow">
                <i className={`bi ${copy.icon}`} /> Indexing DB
              </span>
              <h2>
                Explore indexed <span>{kind === "countries" ? "countries" : copy.title.toLowerCase()}.</span>
              </h2>
              <p>{(kind === "authors" || kind === "affiliations" || kind === "countries") && !hasSearched ? `Enter a full or partial ${kind === "authors" ? "author" : kind === "affiliations" ? "affiliation" : "country"} name to find matching records.` : <>{pagination.totalRecords.toLocaleString()} records available · 20 records per page</>}</p>
            </div>
            <div className="indexing-tools">
              {kind === "resources" && (
                <div className="citemetrix-method">
                  <div className="citemetrix-method-icon">
                    <i className="bi bi-graph-up-arrow" />
                  </div>
                  <b>
                    CiteMetrix{" "}
                    <button
                      type="button"
                      className="cms-info-button"
                      onClick={() => setShowCmsInfo(true)}
                      aria-label="Learn about CiteMetrix Score"
                    >
                      <i className="bi bi-info-circle-fill" />
                    </button>
                  </b>
                  <label>
                    <span>Year</span>
                    <select
                      className="form-select form-select-sm"
                      value={metricYear}
                      onChange={(event) => {
                        setMetricYear(Number(event.target.value));
                        setPage(1);
                      }}
                    >
                      {metricYears.map((year) => (
                        <option value={year} key={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                    <small>
                      {metricYear - 2}–{metricYear}
                    </small>
                  </label>
                </div>
              )}
              <form className={`indexing-search-panel ${kind === "authors" || kind === "affiliations" || kind === "countries" ? "scopus-author-search" : ""}`} onSubmit={submitSearch}>
                {kind === "resources" && (
                  <select
                    className="form-select"
                    value={field}
                    onChange={(event) => {
                      setField(event.target.value);
                      setSuggestions([]);
                      setSuggestionsEnabled(true);
                    }}
                    aria-label="Search field"
                  >
                    <option value="resourceTitle">Resource title</option>
                    <option value="subject">Subject</option>
                    <option value="publisher">Publisher</option>
                    <option value="manuscriptTitle">Manuscript title</option>
                  </select>
                )}
                <div className="indexing-search-field">
                  <div className="indexing-search">
                    <i className="bi bi-search" />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setSuggestionsEnabled(true);
                      }}
                      placeholder={kind === "authors" ? "Enter full or partial author name" : kind === "affiliations" ? "Enter full or partial affiliation name" : kind === "countries" ? "Enter full or partial country name" : `Search ${copy.title.toLowerCase()}`}
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={suggestions.length > 0}
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setDebouncedQuery("");
                          setSuggestions([]);
                          setSuggestionsEnabled(false);
                          if (kind === "authors" || kind === "affiliations" || kind === "countries") setHasSearched(false);
                          setPage(1);
                        }}
                        aria-label="Clear search"
                      >
                        <i className="bi bi-x-lg" />
                      </button>
                    )}
                  </div>
                  {suggestions.length > 0 && (
                    <div className="indexing-suggestions" role="listbox">
                      {suggestions.map((title) => (
                        <button
                          type="button"
                          key={title}
                          role="option"
                          onClick={() => {
                            setQuery(formatSuggestion(title));
                            setSuggestions([]);
                            setSuggestionsEnabled(false);
                          }}
                        >
                          <i className={`bi ${kind === "authors" ? "bi-person" : kind === "affiliations" ? "bi-buildings" : kind === "countries" ? "bi-globe2" : "bi-journal-text"}`} />
                          <span>{formatSuggestion(title)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button type="submit" className="btn indexing-search-submit">
                  <i className="bi bi-search" />
                  <span>Search</span>
                </button>
              </form>
              {kind === "authors" && (
                <div className="author-advanced-search">
                  <button type="button" className="author-advanced-toggle" onClick={() => setShowAdvancedSearch((current) => !current)} aria-expanded={showAdvancedSearch}>
                    <i className={`bi ${showAdvancedSearch ? "bi-chevron-up" : "bi-sliders"}`} /> Advanced search
                  </button>
                  {showAdvancedSearch && <div className="author-country-search"><label htmlFor="author-country">Country</label><div className="indexing-search-field"><input id="author-country" className="form-control" value={countryQuery} onChange={(event) => { setCountryQuery(event.target.value); setCountrySuggestionsEnabled(true); }} placeholder="Enter full or partial country name" autoComplete="off" aria-autocomplete="list" aria-expanded={countrySuggestions.length > 0}/>{countrySuggestions.length > 0 && <div className="indexing-suggestions author-country-suggestions" role="listbox">{countrySuggestions.map((country) => <button type="button" key={country} role="option" onClick={() => { setCountryQuery(country); setCountrySuggestions([]); setCountrySuggestionsEnabled(false); }}><i className="bi bi-globe2"/><span>{country}</span></button>)}</div>}</div></div>}
                </div>
              )}
              {kind === "authors" && hasSearched && <div className="author-search-summary"><i className="bi bi-person-check"/><span>Results for <strong>{debouncedQuery || "all authors"}</strong>{submittedCountry && <> in <strong>{submittedCountry}</strong></>}</span></div>}
              {kind === "affiliations" && hasSearched && <div className="author-search-summary"><i className="bi bi-building-check"/><span>Results for <strong>{debouncedQuery || "all affiliations"}</strong></span></div>}
              {kind === "countries" && hasSearched && <div className="author-search-summary"><i className="bi bi-globe2"/><span>Results for <strong>{debouncedQuery}</strong></span></div>}
              {(kind === "authors" || kind === "affiliations") && hasSearched && records.length > 0 && <div className="author-merge-actions">
                <span><i className="bi bi-check2-square"/> {(kind === "affiliations" ? selectedAffiliationIds : selectedAuthorIds).length} profile{(kind === "affiliations" ? selectedAffiliationIds : selectedAuthorIds).length === 1 ? "" : "s"} selected</span>
                <button type="button" className="btn btn-primary btn-sm" disabled={(kind === "affiliations" ? selectedAffiliationIds : selectedAuthorIds).length < 2 || mergeSubmitting} onClick={submitMergeRequest}>
                  {mergeSubmitting ? <><span className="spinner-border spinner-border-sm me-2"/>Submitting…</> : <><i className="bi bi-people me-2"/>Merge Request</>}
                </button>
              </div>}
            </div>
          </div>
          {(kind === "authors" || kind === "affiliations") && mergeNotice && <div className="alert alert-success author-merge-alert"><i className="bi bi-check-circle-fill"/> {mergeNotice}</div>}
          {(kind === "authors" || kind === "affiliations") && mergeError && <div className="alert alert-danger author-merge-alert"><i className="bi bi-exclamation-triangle-fill"/> {mergeError}</div>}
          {error && <div className="alert alert-danger">{error}</div>}
          <div
            className={
              kind === "resources"
                ? "indexing-resource-layout"
                : "indexing-results-only"
            }
          >
            {kind === "resources" && (
              <aside className="indexing-filters">
                <div className="indexing-filter-title">
                  <i className="bi bi-funnel" />
                  <div>
                    <b>Filters</b>
                    <small>Resource type</small>
                  </div>
                </div>
                {[
                  ["Journal", "bi-journal-text"],
                  ["Book Series", "bi-bookshelf"],
                  ["Conference Proceedings", "bi-mic"],
                ].map(([value, icon]) => (
                  <label
                    key={value}
                    className={draftTypes.includes(value) ? "active" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={draftTypes.includes(value)}
                      onChange={() => toggleType(value)}
                    />
                    <i className={`bi ${icon}`} />
                    <span>{value}</span>
                  </label>
                ))}
                <div className="indexing-year-filter">
                  <label htmlFor="resource-year-filter">Publication year</label>
                  <input id="resource-year-filter" className="form-control" type="number" min="1900" max={previousYear} placeholder="Type year" value={filterYear} onChange={(event)=>setFilterYear(event.target.value.replace(/\D/g,"").slice(0,4))}/>
                </div>
                <button type="button" className="btn indexing-apply-filters" onClick={()=>{setTypes(draftTypes);setAppliedYear(filterYear);setPage(1);}}><i className="bi bi-check2-circle"/> Apply</button>
                {(draftTypes.length > 0 || filterYear) && (
                  <button
                    className="indexing-clear-filters"
                    onClick={() => {
                      setTypes([]);
                      setDraftTypes([]);
                      setFilterYear("");
                      setAppliedYear("");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </aside>
            )}
            <div className={`indexing-table-card ${kind === "resources" && scrollAtEnd ? "scroll-end" : ""}`}>
              <div className={`resource-table-shell d-flex align-items-stretch ${kind === "affiliations" ? "affiliation-table-shell" : ""}`}>
              <div className="table-responsive" ref={kind === "resources" ? resourceTableRef : undefined} onScroll={kind === "resources" ? event=>{const element=event.currentTarget;setScrollAtEnd(element.scrollLeft+element.clientWidth>=element.scrollWidth-2);} : undefined}>
                <table className={`table table-hover align-middle mb-0 ${kind === "resources" ? "text-nowrap" : ""} ${kind === "authors" ? "indexing-authors-table" : kind === "affiliations" ? "indexing-affiliations-table" : kind === "countries" ? "indexing-countries-table" : ""}`}>
                  {kind === "resources" && <colgroup><col className="resource-title-col"/><col/><col/><col/><col/><col/><col/><col className="scroll-control-col"/><col/><col className="publisher-col"/></colgroup>}
                  <thead>
                    {kind === "resources" ? (
                      <tr>
                        <th>Resource Title</th>
                        <th className="text-center"><span className="metric-heading">Papers<small>{metricYear - 2}–{metricYear}</small></span></th>
                        <th className="text-center"><span className="metric-heading">Citations<small>{metricYear - 2}–{metricYear}</small></span></th>
                        <th className="text-center"><span className="metric-heading">CiteMetrix<small>{metricYear - 2}–{metricYear}</small></span></th>
                        <th className="text-center">Percentile</th>
                        <th className="text-center">H-index</th>
                        <th className="text-center"><span className="i10-heading">i10-Index</span></th>
                        <th className="resource-scroll-cell p-0"><button type="button" className={`resource-scroll-button ${scrollAtEnd?'reverse':''}`} title={scrollAtEnd?'Return to the first columns':'Scroll metrics to the right'} aria-label={scrollAtEnd?'Return to the first resource columns':'Scroll resource metrics to the right'} onClick={()=>scrollAtEnd?resourceTableRef.current?.scrollTo({left:0,behavior:"smooth"}):resourceTableRef.current?.scrollTo({left:resourceTableRef.current.scrollWidth,behavior:"smooth"})}><i className={`bi ${scrollAtEnd?'bi-chevron-left':'bi-chevron-right'}`}/></button></th>
                        <th className="text-center">Cited %</th>
                        <th className="text-start">Publisher</th>
                      </tr>
                    ) : kind === "authors" ? (
                      <tr>
                        <th className="author-select-column"><span className="visually-hidden">Select</span></th>
                        <th>Author</th>
                        <th>Affiliation</th>
                        <th>Country</th>
                        <th className="text-center">Papers published</th>
                        <th className="text-center">H-index</th>
                        <th className="text-center"><span className="i10-heading">i-10 Index</span></th>
                      </tr>
                    ) : kind === "affiliations" ? (
                      <tr>
                        <th className="author-select-column"><span className="visually-hidden">Select</span></th>
                        <th>Affiliation</th>
                        <th>Address</th>
                        <th>Country</th>
                        <th className="text-center">Authors</th>
                        <th className="text-center">Papers</th>
                        <th className="text-center">Citations</th>
                        <th className="text-center">H-index</th>
                        <th className="text-center"><span className="i10-heading">i10-Index</span></th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Country</th>
                        <th className="text-center">Authors</th>
                        <th className="text-center">Affiliations</th>
                        <th className="text-center">Papers published</th>
                        <th className="text-center">H-index</th>
                        <th className="text-center"><span className="i10-heading">i10-Index</span></th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {kind === "authors" && !hasSearched && (
                      <tr className="author-search-hint-row">
                        <td colSpan={7}>
                          <div className="author-search-summary author-search-hint">
                            <i className="bi bi-info-circle" />
                            <span>
                              <strong>Find an author profile</strong> by entering the author's name or author ID.
                              <br />
                              <small>
                                <strong>Note:</strong> Author profiles are generated from the articles indexed in this database and may not represent an author's complete publication record.
                              </small>
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {loading && (
                      <tr>
                        <td colSpan={kind === "resources" ? 10 : kind === "authors" ? 7 : kind === "affiliations" ? 9 : 6}>
                          <div className="indexing-state">
                            <span className="spinner-border spinner-border-sm" />{" "}
                            Loading {copy.title.toLowerCase()}…
                          </div>
                        </td>
                      </tr>
                    )}
                    {!loading && !records.length && ((kind !== "authors" && kind !== "affiliations" && kind !== "countries") || hasSearched) && (
                      <tr>
                        <td colSpan={kind === "resources" ? 10 : kind === "authors" ? 7 : kind === "affiliations" ? 9 : 6}>
                          {kind === "resources" ? (
                            <div className="indexing-state indexing-empty-alert">
                              <i className="bi bi-exclamation-triangle-fill" />
                              <div>
                                <strong>No resources were found.</strong>
                                <span>
                                  Please update your search phrase and perform
                                  the search again.
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="indexing-state">
                              <i className="bi bi-search" /> No matching records
                              found.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      kind === "resources" &&
                      (records as Resource[]).map((item) => (
                        <tr key={item.id}>
                          <td>
                            <Link
                              className="indexing-resource-name"
                              to={`/indexing-db/resources/${item.id}`}
                            >
                              {toArticleTitleCase(item.title)}{item.abbreviation&&<> <span className="resource-abbreviation">({item.abbreviation.toLocaleUpperCase()})</span></>}
                            </Link>
                          </td>
                          <td className="text-center">{item.papers.toLocaleString()}</td>
                          <td className="text-center">{item.citations.toLocaleString()}</td>
                          <td className="text-center">
                            <span className="metric-score">
                              {Number(item.citeMetrixScore.toFixed(2))}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className="percentile-badge">
                              {Math.round(item.percentile)}%
                            </span>
                          </td>
                          <td className="text-center"><b>{item.hIndex}</b></td>
                          <td className="text-center"><b>{item.i10Index}</b></td>
                          <td className="resource-scroll-spacer" aria-hidden="true" />
                          <td className="text-center">{Number(item.citedPercent.toFixed(1))}%</td>
                          <td className="text-start"><span className="resource-publisher">{item.publisher || "—"}</span></td>
                        </tr>
                      ))}
                    {!loading &&
                      kind === "authors" &&
                      (records as Author[]).map((item) => (
                        <tr key={item.id}>
                          <td className="author-select-column">
                            <input className="form-check-input" type="checkbox" checked={selectedAuthorIds.includes(item.id)} onChange={() => toggleAuthorSelection(item.id)} aria-label={`Select Author ID ${item.id}`}/>
                          </td>
                          <td>
                            <Link className="indexed-author-name" to={`/indexing-db/authors/${item.id}`}>
                              {[item.salutation, item.name]
                                .filter(Boolean)
                                .join(" ")}
                            </Link>
                            <small>Author ID {item.id}</small>
                          </td>
                          <td>{item.affiliations?.length ? <div className="author-result-affiliations">{item.affiliations.map((affiliation) => <div key={affiliation.id}><span>{affiliation.name}</span>{affiliation.designations?.map((designation) => <em key={designation}>{designation}</em>)}<small>{affiliation.startYear && affiliation.endYear ? `(${affiliation.startYear}–${affiliation.endYear})` : affiliation.startYear ? `(From ${affiliation.startYear})` : affiliation.endYear ? `(Until ${affiliation.endYear})` : "(Period unavailable)"}</small></div>)}</div> : item.affiliation || "—"}</td>
                          <td>{item.country || "—"}</td>
                          <td className="text-center">{item.papers}</td>
                          <td className="text-center"><b>{item.hIndex}</b></td>
                          <td className="text-center"><b>{item.i10Index}</b></td>
                        </tr>
                      ))}
                    {!loading &&
                      kind === "affiliations" &&
                      (records as Affiliation[]).map((item) => (
                        <tr key={item.id}>
                          <td className="author-select-column"><input className="form-check-input" type="checkbox" checked={selectedAffiliationIds.includes(item.id)} onChange={() => toggleAffiliationSelection(item.id)} aria-label={`Select Affiliation ID ${item.id}`}/></td>
                          <td>
                            <b>{item.name}</b>
                            <small>Affiliation ID {item.id}</small>
                          </td>
                          <td>{item.address || "—"}</td>
                          <td>{item.country || "—"}</td>
                          <td className="text-center">{item.authors}</td>
                          <td className="text-center">{item.papers}</td>
                          <td className="text-center">{item.citations}</td>
                          <td className="text-center"><b>{item.hIndex}</b></td>
                          <td className="text-center"><b>{item.i10Index}</b></td>
                        </tr>
                      ))}
                    {!loading &&
                      kind === "countries" &&
                      (records as Country[]).map((item) => (
                        <tr key={item.country}>
                          <td>
                            <span className="country-name">
                              <i className="bi bi-geo-alt" />
                              {item.country}
                            </span>
                          </td>
                          <td className="text-center">{item.authors}</td>
                          <td className="text-center">{item.affiliations}</td>
                          <td className="text-center">{item.papers}</td>
                          <td className="text-center"><b>{item.hIndex}</b></td>
                          <td className="text-center"><b>{item.i10Index}</b></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              </div>
              <PublicPagination pagination={pagination} onChange={setPage} />
            </div>
          </div>
        </div>
      </section>
      {showCmsInfo && (
        <div
          className="cms-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCmsInfo(false);
          }}
        >
          <div
            className="cms-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cms-modal-title"
          >
            <div className="cms-modal-header">
              <div>
                <span className="cms-modal-icon">
                  <i className="bi bi-bar-chart-line-fill" />
                </span>
                <h3 id="cms-modal-title">About CiteMetrix Score</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCmsInfo(false)}
                aria-label="Close CiteMetrix information"
              >
                <i className="bi bi-x-lg" />
              </button>
            </div>
            <div className="cms-modal-body">
              <p>
                CiteMetrix evaluates a resource using its publications and
                citations recorded during a rolling three-year period.
              </p>
              <div
                className="cms-formula"
                aria-label="CiteMetrix Score equals total citations divided by total publications during the last three years"
              >
                <strong>CiteMetrix Score (CMS) =</strong>
                <span className="cms-fraction">
                  <span>
                    Total citations to publications published during the last
                    three years
                  </span>
                  <span>
                    Total publications published during the last three years
                  </span>
                </span>
              </div>
              <p>
                The selected metrics window is{" "}
                <strong>
                  {metricYear - 2}–{metricYear}
                </strong>
                . Changing the year recalculates CiteMetrix, citations, papers,
                cited percentage, percentile and H-index for that period.
              </p>
              <p className="mb-0">
                A score of zero is shown when no qualifying citation is
                available for the selected period.
              </p>
            </div>
            <div className="cms-modal-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCmsInfo(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PublicPagination({
  pagination,
  onChange,
}: {
  pagination: Pagination;
  onChange: (page: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;
  const windowSize=10,start=Math.max(1,Math.min(pagination.page-4,pagination.totalPages-windowSize+1)),end=Math.min(pagination.totalPages,start+windowSize-1),controls:Array<number|"ellipsis">=[];
  if(start>1){controls.push(1);if(start>2)controls.push("ellipsis");}
  for(let value=start;value<=end;value++)controls.push(value);
  if(end<pagination.totalPages){if(end<pagination.totalPages-1)controls.push("ellipsis");controls.push(pagination.totalPages);}
  return (
    <div className="indexing-pagination">
      <small>
        Showing {(pagination.page - 1) * pagination.pageSize + 1}–
        {Math.min(
          pagination.page * pagination.pageSize,
          pagination.totalRecords,
        )}{" "}
        of {pagination.totalRecords.toLocaleString()}
      </small>
      <nav>
        <ul className="pagination pagination-sm mb-0">
          <li
            className={`page-item ${pagination.page === 1 ? "disabled" : ""}`}
          >
            <button
              className="page-link"
              disabled={pagination.page === 1}
              onClick={() => onChange(pagination.page - 1)}
            >
              <i className="bi bi-chevron-left" />
            </button>
          </li>
          {controls.map((control, index) =>
            control === "ellipsis" ? (
              <li className="page-item disabled" key={`e-${index}`}>
                <span className="page-link">…</span>
              </li>
            ) : (
              <li
                className={`page-item ${control === pagination.page ? "active" : ""}`}
                key={control}
              >
                <button className="page-link" onClick={() => onChange(control)}>
                  {control}
                </button>
              </li>
            ),
          )}
          <li
            className={`page-item ${pagination.page === pagination.totalPages ? "disabled" : ""}`}
          >
            <button
              className="page-link"
              disabled={pagination.page === pagination.totalPages}
              onClick={() => onChange(pagination.page + 1)}
            >
              <i className="bi bi-chevron-right" />
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
