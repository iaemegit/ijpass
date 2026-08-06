import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/auth";
import { toArticleTitleCase } from "../lib/text";
import "./IndexedJournalPage.css";

type ResourceProfile = {
  id: number;
  title: string;
  abbreviation: string | null;
  subjectArea: string | null;
  resourceType: string;
  publisher: string | null;
  country: string | null;
  website: string | null;
  editorInChief: string | null;
  editorInChiefEmail: string | null;
  yearsCovered: { from: number | null; to: number | null };
};
type CiteMetrix = {
  startYear: number;
  endYear: number;
  citeMetrixScore: number;
  percentile: number;
  citations: number;
  papers: number;
  citedPercent: number;
  hIndex: number;
  i10Index: number;
};
type ResearchInsights = {
  rank: number;
  peerResources: number;
  percentile: number;
  quartile: string;
  subjectArea: string | null;
  trend: Array<{ year: number; startYear: number; score: number; papers: number; citations: number }>;
};
type ScholarlyCoverage = {
  articles: number;
  authors: number;
  volumes: number;
  issues: number;
  doiRecords: number;
  years: Array<{ year: number; articles: number }>;
  subjectAreas: Array<{ id: number; subjectArea: string; articles: number }>;
};
type ProfileResponse = {
  resource: ResourceProfile;
  citeMetrix: CiteMetrix;
  researchInsights: ResearchInsights;
  scholarlyCoverage: ScholarlyCoverage;
};
type Journal = { id: number; title: string; abbreviation: string | null };
type Article = { id: number; title: string; authors: string; authorProfiles: Array<{ profileId: number | null; name: string }>; volume?: string | null; issue?: string | null; publicationYear?: number | null; citationCount: number };
type Pagination = { page: number; pageSize: number; totalRecords: number; totalPages: number };
type TabId = "citemetrix" | "insights" | "coverage";

const initialPagination: Pagination = { page: 1, pageSize: 20, totalRecords: 0, totalPages: 1 };
const currentYear = new Date().getFullYear();
const metricYears = Array.from({ length: currentYear - 2017 }, (_, index) => currentYear - index);

const displayNumber = (value: number) => value.toLocaleString();
const displayDecimal = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");

export default function IndexedJournalPage() {
  const { sourceId = "" } = useParams();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("citemetrix");
  const [coverageYear, setCoverageYear] = useState<number | null>(null);
  const [metricYear, setMetricYear] = useState(currentYear);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(initialPagination);
  const [reportCitations, setReportCitations] = useState(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [articleError, setArticleError] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setProfileLoading(true);
    setProfileError("");
    api.get<ProfileResponse>(`/journal-index/${sourceId}/profile`, {
      params: { year: metricYear },
      signal: controller.signal,
    }).then(({ data }) => setProfile(data))
      .catch((error) => {
        if (error.code !== "ERR_CANCELED") setProfileError(error.response?.status === 404 ? "The requested indexed resource was not found." : "The resource profile could not be loaded. Please try again.");
      }).finally(() => { if (!controller.signal.aborted) setProfileLoading(false); });
    return () => controller.abort();
  }, [metricYear, sourceId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setArticlesLoading(true);
      setArticleError("");
      api.get<{ journal: Journal; articles: Article[]; reportSummary?: { totalCitations: number }; pagination: Pagination }>(`/journal-index/${sourceId}/articles`, {
        params: { q: query.trim() || undefined, page, year: coverageYear || undefined },
        signal: controller.signal,
      }).then(({ data }) => {
        setJournal(data.journal);
        setArticles(data.articles);
        setReportCitations(data.reportSummary?.totalCitations || 0);
        setPagination(data.pagination);
        if (data.pagination.page !== page) setPage(data.pagination.page);
      }).catch((error) => {
        if (error.code !== "ERR_CANCELED") setArticleError(error.response?.status === 404 ? "The requested indexed resource was not found." : "The indexed articles could not be loaded. Please try again.");
      }).finally(() => { if (!controller.signal.aborted) setArticlesLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [coverageYear, page, query, sourceId]);

  useEffect(() => {
    if (!suggestionsEnabled || query.trim().length < 2 || !sourceId) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.get<{ suggestions: string[] }>(`/journal-index/${sourceId}/articles/suggestions`, {
        params: { q: query.trim() },
        signal: controller.signal,
      }).then(({ data }) => setSuggestions(data.suggestions || []))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, sourceId, suggestionsEnabled]);

  const resource = profile?.resource;
  const title = resource?.title || journal?.title;
  const abbreviation = resource?.abbreviation || journal?.abbreviation;
  const changeQuery = (value: string) => { setQuery(value); setPage(1); setSuggestionsEnabled(true); };
  const pages = Array.from({ length: Math.min(5, pagination.totalPages) }, (_, index) => Math.max(1, Math.min(pagination.page - 2, pagination.totalPages - 4)) + index);
  const volumeIssue = (article: Article) => article.volume ? `${article.volume}${article.issue ? ` (${article.issue})` : ""}` : article.issue ? `— (${article.issue})` : "—";
  const firstEmail = resource?.editorInChiefEmail?.split(/[;,]/)[0]?.trim() || "";

  const trendChart = useMemo(() => {
    const trend = profile?.researchInsights.trend || [];
    const width = 660, height = 230, left = 48, right = 22, top = 22, bottom = 42;
    const maxScore = Math.max(1, ...trend.map((point) => point.score));
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const points = trend.map((point, index) => ({
      ...point,
      x: left + (trend.length === 1 ? plotWidth / 2 : index * plotWidth / (trend.length - 1)),
      y: top + plotHeight - point.score / maxScore * plotHeight,
    }));
    return { width, height, left, right, top, bottom, maxScore, points, polyline: points.map((point) => `${point.x},${point.y}`).join(" ") };
  }, [profile?.researchInsights.trend]);

  const tabs: Array<{ id: TabId; label: string; icon: string; text: string }> = [
    { id: "citemetrix", label: "CiteMetrix", icon: "bi-speedometer2", text: "Three-year citation performance" },
    { id: "insights", label: "CiteMetrix Research Insights", icon: "bi-graph-up-arrow", text: "Rank, percentile and trend" },
    { id: "coverage", label: "Scholarly Coverage", icon: "bi-journals", text: "Indexed content and articles" },
  ];

  return <>
    <section className="page-hero indexed-journal-hero resource-detail-hero"><div className="container"><div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/indexing-db/resources">Resources</Link><i className="bi bi-chevron-right"/><span>Resource Profile</span></div><h1>Indexed Resource</h1></div></section>

    <section className="resource-profile-page"><div className="container">
      {profileError && <div className="alert alert-danger mt-4">{profileError}</div>}
      {profileLoading && !profile ? <div className="resource-profile-loading"><span className="spinner-border"/><span>Loading resource profile…</span></div> : resource && <>
        <div className="resource-metadata-card">
          <div className="resource-metadata-heading"><span><i className="bi bi-journal-richtext"/></span><div><small>Resource title</small><h2>{toArticleTitleCase(resource.title)}{resource.abbreviation && <strong> ({resource.abbreviation.toLocaleUpperCase()})</strong>}</h2></div></div>
          <div className="resource-metadata-grid">
            <div><span>Resource ID</span><strong>{resource.id}</strong></div>
            <div><span>Years covered</span><strong>{resource.yearsCovered.from || "—"} – {resource.yearsCovered.to || "—"}</strong></div>
            <div><span>Subject area</span><strong>{resource.subjectArea || "Not specified"}</strong></div>
            <div><span>Resource type</span><strong>{resource.resourceType}</strong></div>
            <div><span>Publisher</span><strong>{resource.publisher || "—"}</strong></div>
            <div><span>Country</span><strong>{resource.country || "—"}</strong></div>
            <div><span>Website</span><strong>{resource.website ? <a href={resource.website} target="_blank" rel="noreferrer">Visit resource <i className="bi bi-box-arrow-up-right"/></a> : "—"}</strong></div>
            <div><span>Editor in Chief Email</span><strong>{resource.editorInChiefEmail ? <a href={firstEmail ? `mailto:${firstEmail}` : undefined}>{resource.editorInChiefEmail}</a> : "—"}</strong></div>
          </div>
        </div>

        <div className="resource-profile-layout">
          <aside className="resource-profile-tabs" aria-label="Resource profile sections">{tabs.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)} aria-selected={activeTab === tab.id}><i className={`bi ${tab.icon}`}/><span><strong>{tab.label}</strong><small>{tab.text}</small></span><i className="bi bi-chevron-right"/></button>)}</aside>

          <div className="resource-profile-content">
            {activeTab === "citemetrix" && profile.citeMetrix && <section className="resource-tab-panel"><div className="resource-panel-heading"><div><span className="eyebrow">Citation performance</span><h2>CiteMetrix</h2><p>Research influence calculated across a rolling three-year publication and citation window.</p></div><label>Metrics year<select className="form-select" value={metricYear} onChange={(event) => setMetricYear(Number(event.target.value))}>{metricYears.map((year) => <option key={year} value={year}>{year}</option>)}</select><small>{profile.citeMetrix.startYear}–{profile.citeMetrix.endYear}</small></label></div>
              <div className="citemetrix-primary"><div><span>CiteMetrix score</span><strong>{displayDecimal(profile.citeMetrix.citeMetrixScore)}</strong><small>{profile.citeMetrix.citations.toLocaleString()} citations ÷ {profile.citeMetrix.papers.toLocaleString()} papers</small></div><div className="citemetrix-formula"><span>Calculation</span><p><b>CiteMetrix</b> = citations received by publications in the selected three-year window ÷ publications in that window.</p></div></div>
              <div className="resource-metric-grid">{[
                ["bi-file-earmark-text", "Papers", displayNumber(profile.citeMetrix.papers), `${profile.citeMetrix.startYear}–${profile.citeMetrix.endYear}`],
                ["bi-quote", "Citations", displayNumber(profile.citeMetrix.citations), `${profile.citeMetrix.startYear}–${profile.citeMetrix.endYear}`],
                ["bi-patch-check", "Cited papers", `${displayDecimal(profile.citeMetrix.citedPercent)}%`, "Share receiving citations"],
                ["bi-bar-chart-steps", "H-index", displayNumber(profile.citeMetrix.hIndex), "Three-year window"],
                ["bi-list-ol", "i10-Index", displayNumber(profile.citeMetrix.i10Index), "Papers with 10+ citations"],
              ].map(([icon, label, value, note]) => <div key={label}><i className={`bi ${icon}`}/><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
            </section>}

            {activeTab === "insights" && <section className="resource-tab-panel"><div className="resource-panel-heading"><div><span className="eyebrow">Comparative performance</span><h2>CiteMetrix Research Insights</h2><p>Subject-based rank, percentile position and rolling CiteMetrix trend.</p></div><span className="metric-window-badge">{profile.citeMetrix.startYear}–{profile.citeMetrix.endYear}</span></div>
              <div className="insight-summary-grid"><div><span>Subject rank</span><strong>{profile.researchInsights.rank ? `#${profile.researchInsights.rank}` : "—"}</strong><small>of {profile.researchInsights.peerResources.toLocaleString()} resources</small></div><div><span>Percentile</span><strong>{profile.researchInsights.percentile}%</strong><small>Within {profile.researchInsights.subjectArea || "the peer group"}</small></div><div><span>Quartile</span><strong>{profile.researchInsights.quartile}</strong><small>Based on CiteMetrix percentile</small></div></div>
              <div className="citemetrix-trend-card"><div><h3>CiteMetrix trend</h3><p>Each point represents a rolling three-year window ending in the displayed year.</p></div><div className="trend-chart-scroll"><svg className="citemetrix-trend-chart" viewBox={`0 0 ${trendChart.width} ${trendChart.height}`} role="img" aria-label="CiteMetrix score trend">{[0, .25, .5, .75, 1].map((ratio) => { const y = trendChart.top + (1 - ratio) * (trendChart.height - trendChart.top - trendChart.bottom); return <g key={ratio}><line x1={trendChart.left} x2={trendChart.width - trendChart.right} y1={y} y2={y}/><text x={trendChart.left - 10} y={y + 4} textAnchor="end">{displayDecimal(trendChart.maxScore * ratio)}</text></g>; })}<polyline points={trendChart.polyline}/>{trendChart.points.map((point) => <g key={point.year}><circle cx={point.x} cy={point.y} r="5"/><text className="chart-value" x={point.x} y={point.y - 12} textAnchor="middle">{displayDecimal(point.score)}</text><text className="chart-year" x={point.x} y={trendChart.height - 14} textAnchor="middle">{point.year}</text></g>)}</svg></div></div>
            </section>}

            {activeTab === "coverage" && <section className="resource-tab-panel scholarly-coverage-panel"><div className="resource-panel-heading"><div><span className="eyebrow">Indexed content</span><h2>Scholarly Coverage</h2><p>Coverage by publication year, subject area and indexed article metadata.</p></div></div>
              <div className="coverage-summary-grid">{[
                ["Indexed articles", profile.scholarlyCoverage.articles], ["Indexed authors", profile.scholarlyCoverage.authors], ["Volumes", profile.scholarlyCoverage.volumes], ["Issues", profile.scholarlyCoverage.issues], ["DOI records", profile.scholarlyCoverage.doiRecords],
              ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>)}</div>
              {profile.scholarlyCoverage.years.length > 0 && <div className="coverage-by-year"><h3>Articles by publication year</h3>{profile.scholarlyCoverage.years.map((item) => { const maximum = Math.max(...profile.scholarlyCoverage.years.map((year) => year.articles), 1); return <div key={item.year}><span>{item.year}</span><div><i style={{ width: `${Math.max(5, item.articles / maximum * 100)}%` }}/></div><strong>{item.articles}</strong></div>; })}</div>}
              {profile.scholarlyCoverage.subjectAreas.length > 0 && <div className="coverage-subjects"><h3>Subject areas represented</h3><div>{profile.scholarlyCoverage.subjectAreas.map((subject) => <span key={subject.id}>{subject.subjectArea}<b>{subject.articles}</b></span>)}</div></div>}

              <div className="coverage-year-index"><div className="coverage-index-heading"><div><span className="eyebrow">Article index</span><h3>Articles by year</h3></div><span>{profile.scholarlyCoverage.articles.toLocaleString()} papers indexed</span></div><div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Year</th><th className="text-center">Papers published</th><th className="text-end">Citation report</th></tr></thead><tbody>{profile.scholarlyCoverage.years.map((item) => <tr key={item.year}><td><strong>{item.year}</strong></td><td className="text-center"><span className="coverage-paper-count">{item.articles.toLocaleString()}</span></td><td className="text-end"><button type="button" className="open-citation-report" onClick={() => { setCoverageYear(item.year); setPage(1); }}>Open Citation Report <i className="bi bi-window"/></button></td></tr>)}</tbody></table></div></div>
              {coverageYear && <div className="citation-report-modal" role="dialog" aria-modal="true" aria-labelledby="citation-report-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setCoverageYear(null); }}><div className="modal-dialog modal-xl modal-dialog-centered"><div className="modal-content"><div className="modal-header"><div className="citation-report-title-group"><span className="citation-report-icon"><i className="bi bi-file-earmark-bar-graph"/></span><div><span className="eyebrow">Scholarly Coverage</span><h3 className="modal-title" id="citation-report-title">Citation Report</h3><p>{toArticleTitleCase(resource.title)}</p></div></div><div className="citation-report-summary"><span><small>Publication year</small><strong>{coverageYear}</strong></span><span><small>Papers published</small><strong>{pagination.totalRecords.toLocaleString()}</strong></span><span><small>Total citations</small><strong>{reportCitations.toLocaleString()}</strong></span></div><button type="button" className="btn-close" aria-label="Close citation report" onClick={() => setCoverageYear(null)}/></div><div className="modal-body">
                {articleError && <div className="alert alert-danger">{articleError}</div>}
                <div className="journal-index-table-wrap"><div className="table-responsive"><table className="table journal-index-table indexed-articles-table citation-report-table align-middle mb-0"><thead><tr><th>Paper title</th><th>Authors</th><th>Volume (Issue), Year</th><th className="text-center">Citations</th></tr></thead><tbody>
                  {articlesLoading && <tr><td colSpan={4}><div className="journal-index-state"><span className="spinner-border spinner-border-sm"/> Loading citation report…</div></td></tr>}
                  {!articlesLoading && !articles.length && <tr><td colSpan={4}><div className="journal-index-state"><i className="bi bi-file-earmark-x"/> No papers were indexed for this year.</div></td></tr>}
                  {!articlesLoading && articles.map((article) => <tr key={article.id}><td><Link className="indexed-article-link" to={`/journal-ranking/index/${sourceId}/${article.id}`}>{toArticleTitleCase(article.title)}<i className="bi bi-arrow-right"/></Link></td><td className="article-authors"><div className="citation-report-authors">{article.authorProfiles?.length ? article.authorProfiles.map((author, index) => <span key={`${author.profileId || "unlinked"}-${author.name}-${index}`}>{author.profileId ? <Link to={`/indexing-db/authors/${author.profileId}`}>{author.name}</Link> : author.name}</span>) : article.authors}</div></td><td className="text-nowrap">{volumeIssue(article)}, {article.publicationYear || "—"}</td><td className="text-center"><span className="paper-citation-count">{article.citationCount.toLocaleString()}</span></td></tr>)}
                </tbody></table></div></div>
                {!articlesLoading && pagination.totalPages > 1 && <nav className="journal-index-pagination" aria-label="Citation report pages"><ul className="pagination justify-content-center mb-0"><li className={`page-item ${pagination.page === 1 ? "disabled" : ""}`}><button className="page-link" onClick={() => setPage((value) => Math.max(1, value - 1))}><i className="bi bi-chevron-left"/></button></li>{pages.map((value) => <li className={`page-item ${value === pagination.page ? "active" : ""}`} key={value}><button className="page-link" onClick={() => setPage(value)}>{value}</button></li>)}<li className={`page-item ${pagination.page === pagination.totalPages ? "disabled" : ""}`}><button className="page-link" onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}><i className="bi bi-chevron-right"/></button></li></ul></nav>}
              </div></div></div></div>}
            </section>}
          </div>
        </div>
      </>}
    </div></section>
  </>;
}
