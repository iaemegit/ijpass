import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/auth";
import { toArticleTitleCase } from "../lib/text";
import "./IndexedAuthorProfilePage.css";

type Affiliation = {
  id: number;
  name: string;
  country: string | null;
  designations: string[];
  startYear: number | null;
  endYear: number | null;
  papers: number;
};
type Author = {
  id: number;
  salutation: string | null;
  name: string;
  papers: number;
  citations: number;
  hIndex: number;
  i10Index: number;
  affiliations: Affiliation[];
};
type Paper = {
  id: number;
  title: string;
  sourceId: number;
  sourceTitle: string;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publicationYear: number | null;
  doi: string | null;
  citations: number;
  authors: Array<{ profileId: number | null; name: string }>;
};
type Pagination = { page: number; pageSize: number; totalRecords: number; totalPages: number };
type Analytics = {
  yearlyTrend: Array<{ year: number; papers: number; citations: number }>;
  hGraph: Array<{ manuscriptId: number; title: string; rank: number; citations: number; qualifies: boolean }>;
  citeMetrix: { startYear: number; endYear: number; papers: number; citations: number; score: number };
  collaborators: Array<{ id: number; salutation: string | null; name: string; papers: number }>;
  researchAreas: Array<{ name: string; papers: number }>;
};
type TabKey = "papers" | "impact" | "citemetrix" | "collaborators" | "areas";
const initialPagination: Pagination = { page: 1, pageSize: 20, totalRecords: 0, totalPages: 1 };
const initialAnalytics: Analytics = { yearlyTrend: [], hGraph: [], citeMetrix: { startYear: new Date().getFullYear() - 2, endYear: new Date().getFullYear(), papers: 0, citations: 0, score: 0 }, collaborators: [], researchAreas: [] };

const periodLabel = (affiliation: Affiliation) => {
  if (affiliation.startYear && affiliation.endYear) return `${affiliation.startYear}–${affiliation.endYear}`;
  if (affiliation.startYear) return `From ${affiliation.startYear}`;
  if (affiliation.endYear) return `Until ${affiliation.endYear}`;
  return "Period unavailable";
};

function HIndexGraph({ records, hIndex }: { records: Analytics["hGraph"]; hIndex: number }) {
  if (!records.length) return <div className="author-tab-empty"><i className="bi bi-graph-up"/>H-index graph data is not available.</div>;
  const maximumCitations = Math.max(1, ...records.map((record) => record.citations), hIndex);
  const focusLimit = Math.min(records.length, Math.max(10, (hIndex * 2) + 4, maximumCitations + 3));
  const focusedRecords = records.slice(0, focusLimit);
  const rawStep = Math.max(1, Math.ceil(Math.max(focusLimit, maximumCitations, hIndex + 2) / 6));
  const tickStep = rawStep <= 2 ? rawStep : rawStep <= 5 ? 5 : Math.ceil(rawStep / 5) * 5;
  const axisMaximum = Math.max(tickStep, Math.ceil(Math.max(focusLimit, maximumCitations, hIndex + 2) / tickStep) * tickStep);
  const ticks = Array.from({ length: Math.floor(axisMaximum / tickStep) + 1 }, (_, index) => index * tickStep);
  const width = 520, height = 500, left = 70, top = 24, plotSize = 400;
  const bottom = top + plotSize;
  const x = (rank: number) => left + (rank / axisMaximum) * plotSize;
  const y = (citations: number) => top + (1 - citations / axisMaximum) * plotSize;
  const points = focusedRecords.map((record) => `${x(record.rank)},${y(record.citations)}`).join(" ");
  const highestCitations = records[0]?.citations ?? 0;

  return <div className="author-hgraph">
    <div className="author-chart-heading hgraph-heading">
      <div><h3>H-index graph</h3><p>Publications are ranked from highest to lowest by citations.</p></div>
      <div className="hgraph-index-badge"><small>H-index</small><strong>{hIndex}</strong></div>
    </div>
    <div className="hgraph-layout">
      <div className="author-hgraph-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Citation-rank graph showing an H-index of ${hIndex}`}>
          <rect className="hgraph-plot" x={left} y={top} width={plotSize} height={plotSize}/>
          {ticks.map((tick) => <g key={`grid-${tick}`}>
            <line className="hgraph-grid" x1={left} x2={left + plotSize} y1={y(tick)} y2={y(tick)}/>
            <line className="hgraph-grid" x1={x(tick)} x2={x(tick)} y1={top} y2={bottom}/>
            <text className="hgraph-tick" x={left - 12} y={y(tick) + 4} textAnchor="end">{tick}</text>
            <text className="hgraph-tick" x={x(tick)} y={bottom + 23} textAnchor="middle">{tick}</text>
          </g>)}
          {hIndex > 0 && <rect className="hgraph-h-area" x={left} y={y(hIndex)} width={x(hIndex) - left} height={bottom - y(hIndex)}/>}
          <line className="hgraph-diagonal" x1={x(0)} y1={y(0)} x2={x(axisMaximum)} y2={y(axisMaximum)}/>
          <polyline className="hgraph-line" points={points}/>
          {focusedRecords.map((record) => <circle key={record.manuscriptId} className={record.qualifies ? "hgraph-point qualifies" : "hgraph-point"} cx={x(record.rank)} cy={y(record.citations)} r={record.qualifies ? 5 : 4}>
            <title>{`Rank ${record.rank}: ${record.citations} citation${record.citations === 1 ? "" : "s"} — ${toArticleTitleCase(record.title)}`}</title>
          </circle>)}
          {hIndex > 0 && <>
            <line className="hgraph-threshold" x1={x(hIndex)} x2={x(hIndex)} y1={y(hIndex)} y2={bottom}/>
            <line className="hgraph-threshold" x1={left} x2={x(hIndex)} y1={y(hIndex)} y2={y(hIndex)}/>
            <circle className="hgraph-intersection" cx={x(hIndex)} cy={y(hIndex)} r="8"/>
            <g className="hgraph-callout" transform={`translate(${Math.min(x(hIndex) + 13, left + plotSize - 88)} ${Math.max(y(hIndex) - 36, top + 8)})`}>
              <rect width="76" height="28" rx="5"/><text x="38" y="18" textAnchor="middle">h = {hIndex}</text>
            </g>
          </>}
          <text className="hgraph-axis-label" x={left + plotSize / 2} y={height - 12} textAnchor="middle">Publication rank</text>
          <text className="hgraph-axis-label" transform={`translate(18 ${top + plotSize / 2}) rotate(-90)`} textAnchor="middle">Number of citations</text>
        </svg>
      </div>
      <aside className="hgraph-summary" aria-label="H-index explanation">
        <div className="hgraph-summary-icon"><i className="bi bi-bar-chart-steps"/></div>
        <h4>H-index of {hIndex}</h4>
        <p>{hIndex > 0 ? <><strong>{hIndex} publications</strong> have each received at least <strong>{hIndex} citations</strong>.</> : "No publication currently meets the H-index threshold."}</p>
        <dl>
          <div><dt>Publications assessed</dt><dd>{records.length.toLocaleString()}</dd></div>
          <div><dt>Highest citations</dt><dd>{highestCitations.toLocaleString()}</dd></div>
          <div><dt>Focused graph</dt><dd>Top {focusLimit}</dd></div>
        </dl>
        <div className="hgraph-legend">
          <span><i className="citation-curve"/>Citation curve</span>
          <span><i className="h-reference"/>Reference line (y = x)</span>
          <span><i className="h-intersection"/>H-index intersection</span>
        </div>
      </aside>
    </div>
    {focusLimit < records.length && <p className="hgraph-focus-note"><i className="bi bi-info-circle"/> The graph focuses on the top {focusLimit} ranked publications for readability. The H-index is calculated from all {records.length.toLocaleString()} publications.</p>}
  </div>;
}

function CollaboratorPieChart({ collaborators }: { collaborators: Analytics["collaborators"] }) {
  const colors = ["#087d75", "#2f80c1", "#63b7a7", "#7058b5", "#e08a27", "#d35468", "#8a9aa0"];
  const leading = collaborators.slice(0, 6).map((collaborator) => ({
    id: collaborator.id,
    label: [collaborator.salutation, collaborator.name].filter(Boolean).join(" "),
    value: collaborator.papers,
  }));
  const remainingValue = collaborators.slice(6).reduce((total, collaborator) => total + collaborator.papers, 0);
  const segments = remainingValue ? [...leading, { id: null, label: "Other collaborators", value: remainingValue }] : leading;
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.value, 0));
  const center = 125, radius = 104;
  const point = (angle: number) => ({
    x: center + radius * Math.cos((angle * Math.PI) / 180),
    y: center + radius * Math.sin((angle * Math.PI) / 180),
  });
  let angle = -90;
  const slices = segments.map((segment, index) => {
    const startAngle = angle;
    const sweep = (segment.value / total) * 360;
    const endAngle = startAngle + sweep;
    angle = endAngle;
    const start = point(startAngle), end = point(endAngle);
    return {
      ...segment,
      color: colors[index % colors.length],
      percentage: (segment.value / total) * 100,
      path: sweep >= 359.999
        ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center - .01} ${center - radius} Z`
        : `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`,
    };
  });

  return <div className="collaborator-chart-card">
    <div className="author-chart-heading"><div><h3>Collaboration distribution</h3><p>Shared publications by indexed collaborator.</p></div><span className="collaborator-chart-total"><b>{total}</b> collaboration link{total === 1 ? "" : "s"}</span></div>
    <div className="collaborator-pie-layout">
      <svg className="collaborator-pie" viewBox="0 0 250 250" role="img" aria-label="Pie chart showing shared publications by collaborator">
        {slices.map((slice) => <path key={`${slice.id ?? "other"}-${slice.label}`} d={slice.path} fill={slice.color}>
          <title>{`${slice.label}: ${slice.value} shared paper${slice.value === 1 ? "" : "s"} (${slice.percentage.toFixed(1)}%)`}</title>
        </path>)}
      </svg>
      <div className="collaborator-pie-legend">
        {slices.map((slice) => <div key={`legend-${slice.id ?? "other"}-${slice.label}`}>
          <i style={{ backgroundColor: slice.color }}/>
          <span>{slice.id ? <Link to={`/indexing-db/authors/${slice.id}`}>{slice.label}</Link> : slice.label}<small>{slice.value} paper{slice.value === 1 ? "" : "s"}</small></span>
          <b>{slice.percentage.toFixed(slice.percentage >= 10 ? 0 : 1)}%</b>
        </div>)}
      </div>
    </div>
  </div>;
}

export default function IndexedAuthorProfilePage() {
  const { authorId = "" } = useParams();
  const [author, setAuthor] = useState<Author | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"year" | "papers" | "citations">("citations");
  const [activeTab, setActiveTab] = useState<TabKey>("papers");
  const [analytics, setAnalytics] = useState<Analytics>(initialAnalytics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api.get<{ author: Author; papers: Paper[]; analytics: Analytics; pagination: Pagination }>(`/indexing/authors/${authorId}`, {
      params: { page, sort },
      signal: controller.signal,
    }).then(({ data }) => {
      setAuthor(data.author);
      setPapers(data.papers);
      setAnalytics(data.analytics);
      setPagination(data.pagination);
      if (data.pagination.page !== page) setPage(data.pagination.page);
    }).catch((requestError) => {
      if (requestError.code !== "ERR_CANCELED")
        setError(requestError.response?.status === 404 ? "The requested author profile was not found." : "The author profile could not be loaded. Please try again.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [authorId, page, sort]);

  const pageValues = Array.from({ length: Math.min(7, pagination.totalPages) }, (_, index) =>
    Math.max(1, Math.min(pagination.page - 3, pagination.totalPages - 6)) + index,
  );
  const authorName = author ? [author.salutation, author.name].filter(Boolean).join(" ") : "Author Profile";
  const maximumTrend = Math.max(1, ...analytics.yearlyTrend.flatMap((item) => [item.papers, item.citations]));
  const maximumAreaPapers = Math.max(1, ...analytics.researchAreas.map((area) => area.papers));
  const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: "papers", label: "Papers", icon: "bi-file-earmark-text" },
    { key: "impact", label: "Research Impact", icon: "bi-graph-up-arrow" },
    { key: "citemetrix", label: "CiteMetrix", icon: "bi-bar-chart-line" },
    { key: "collaborators", label: "Collaborators", icon: "bi-people" },
    { key: "areas", label: "Research Areas", icon: "bi-diagram-3" },
  ];

  return <>
    <section className="page-hero indexed-author-hero">
      <div className="container">
        <div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/indexing-db/authors">Authors</Link><i className="bi bi-chevron-right"/><span>Author Profile</span></div>
        <span className="eyebrow-light">IJPAss scholarly database</span>
        <h1>Author Profile</h1>
      </div>
    </section>
    <section className="section-space indexed-author-page"><div className="container">
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && !author && <div className="indexed-author-state"><span className="spinner-border spinner-border-sm"/> Loading author profile…</div>}
      {author && <>
        <div className="author-profile-overview">
          <div className="author-profile-identity"><span><i className="bi bi-person-badge"/></span><div className="author-profile-identity-content"><small>Indexed author</small><h2>{authorName}</h2><p>Author ID {author.id} · {pagination.totalRecords.toLocaleString()} paper{pagination.totalRecords === 1 ? "" : "s"} published</p><div className="author-profile-metrics"><div><b>{author.citations.toLocaleString()}</b><span>Citations</span></div><div><b>{author.hIndex}</b><span>H-index</span></div><div><b>{author.i10Index}</b><span>i10-index</span></div></div></div></div>
          <div className="author-profile-affiliations">
            <h3><i className="bi bi-buildings"/> Affiliations</h3>
            {author.affiliations.length ? <div className="author-affiliation-list">{author.affiliations.map((affiliation) => <article key={`${affiliation.id}-${affiliation.name}`}>
              <div><b>{affiliation.name}</b>{affiliation.designations.map((designation) => <span key={designation}>{designation}</span>)}{affiliation.country && <small><i className="bi bi-geo-alt"/> {affiliation.country}</small>}</div>
              <em><i className="bi bi-calendar3"/> {periodLabel(affiliation)}</em>
            </article>)}</div> : <p className="text-muted mb-0">No affiliation period is available for this author.</p>}
          </div>
        </div>
        <div className="author-profile-tabs">
          <nav className="author-profile-tab-list" aria-label="Author profile sections">
            {tabs.map((tab) => <button type="button" key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)} aria-selected={activeTab === tab.key} role="tab"><i className={`bi ${tab.icon}`}/><span>{tab.label}</span><i className="bi bi-chevron-right author-tab-arrow"/></button>)}
          </nav>
          <div className="author-profile-tab-content" role="tabpanel">
          {activeTab === "papers" && <>
        <div className="author-papers-heading"><div><span className="eyebrow">Published research</span><h2>Published papers</h2></div><div className="author-paper-tools"><span>{pagination.totalRecords.toLocaleString()} records</span><label><span>Sort by</span><select className="form-select form-select-sm" value={sort} onChange={(event) => { setSort(event.target.value as "year" | "papers" | "citations"); setPage(1); }}><option value="year">Year</option><option value="papers">Papers published</option><option value="citations">Citations</option></select></label></div></div>
        <div className="author-papers-table"><div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Paper title</th><th>Authors</th><th>Resource</th><th className="text-center">Volume (Issue) / Year</th><th className="text-center">Citations</th></tr></thead><tbody>
          {loading && <tr><td colSpan={5}><div className="indexed-author-state"><span className="spinner-border spinner-border-sm"/> Loading published papers…</div></td></tr>}
          {!loading && !papers.length && <tr><td colSpan={5}><div className="indexed-author-state"><i className="bi bi-file-earmark-x"/> No linked papers were found.</div></td></tr>}
          {!loading && papers.map((paper) => <tr key={paper.id}>
            <td><Link className="author-paper-title" to={`/journal-ranking/index/${paper.sourceId}/${paper.id}`}>{toArticleTitleCase(paper.title)}</Link></td>
            <td><div className="author-paper-authors">{paper.authors.length ? paper.authors.map((paperAuthor, index) => <span key={`${paperAuthor.profileId ?? "unlinked"}-${paperAuthor.name}-${index}`}>{paperAuthor.profileId ? <Link to={`/indexing-db/authors/${paperAuthor.profileId}`}>{paperAuthor.name}</Link> : paperAuthor.name}</span>) : <span>Author information unavailable</span>}</div></td>
            <td><Link className="author-paper-title" to={`/indexing-db/resources/${paper.sourceId}`}>{toArticleTitleCase(paper.sourceTitle)}</Link></td>
            <td className="text-center"><div className="author-paper-publication"><span>{paper.volume ? `Vol. ${paper.volume}` : "Volume —"}{paper.issue ? ` (${paper.issue})` : ""}</span><small>{paper.publicationYear || "Year —"}</small></div></td>
            <td className="text-center"><b>{paper.citations}</b></td>
          </tr>)}
        </tbody></table></div></div>
        {!loading && pagination.totalPages > 1 && <nav className="journal-index-pagination" aria-label="Published paper pages"><ul className="pagination justify-content-center mb-0"><li className={`page-item ${page === 1 ? "disabled" : ""}`}><button className="page-link" onClick={() => setPage((value) => Math.max(1, value - 1))}><i className="bi bi-chevron-left"/></button></li>{pageValues.map((value) => <li className={`page-item ${value === page ? "active" : ""}`} key={value}><button className="page-link" onClick={() => setPage(value)}>{value}</button></li>)}<li className={`page-item ${page === pagination.totalPages ? "disabled" : ""}`}><button className="page-link" onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}><i className="bi bi-chevron-right"/></button></li></ul></nav>}
        </>}
        {activeTab === "impact" && <section className="author-analytics-section"><div className="author-tab-heading"><span className="eyebrow">Citation performance</span><h2>Research Impact</h2><p>Publication and citation activity calculated from records indexed in this database.</p></div><div className="author-impact-cards"><article><i className="bi bi-file-earmark-text"/><span>Indexed papers</span><b>{author.papers.toLocaleString()}</b></article><article><i className="bi bi-quote"/><span>Total citations</span><b>{author.citations.toLocaleString()}</b></article><article><i className="bi bi-graph-up"/><span>H-index</span><b>{author.hIndex}</b></article><article><i className="bi bi-bar-chart"/><span>i10-index</span><b>{author.i10Index}</b></article></div><div className="author-trend-card"><div className="author-chart-heading"><div><h3>Documents and citations by year</h3><p>Annual indexed output and citations received.</p></div><div className="author-chart-legend"><span><i className="papers"/>Papers</span><span><i className="citations"/>Citations</span></div></div>{analytics.yearlyTrend.length ? <div className="author-year-trend">{analytics.yearlyTrend.map((item) => <div className="author-year-row" key={item.year}><b>{item.year}</b><div><span className="author-trend-bar papers" style={{ width: `${Math.max(3, item.papers / maximumTrend * 100)}%` }}>{item.papers}</span><span className="author-trend-bar citations" style={{ width: `${Math.max(3, item.citations / maximumTrend * 100)}%` }}>{item.citations}</span></div></div>)}</div> : <div className="author-tab-empty"><i className="bi bi-bar-chart"/>Yearly impact data is not available.</div>}</div><HIndexGraph records={analytics.hGraph} hIndex={author.hIndex}/></section>}
        {activeTab === "citemetrix" && <section className="author-analytics-section"><div className="author-tab-heading"><span className="eyebrow">Three-year citation window</span><h2>CiteMetrix</h2><p>Author-level citation performance for publications indexed during {analytics.citeMetrix.startYear}–{analytics.citeMetrix.endYear}.</p></div><div className="author-citemetrix-card"><div className="author-citemetrix-score"><small>CiteMetrix</small><strong>{analytics.citeMetrix.score.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span>{analytics.citeMetrix.startYear}–{analytics.citeMetrix.endYear}</span></div><div className="author-citemetrix-details"><div><span>Citations</span><b>{analytics.citeMetrix.citations.toLocaleString()}</b></div><div><span>Papers</span><b>{analytics.citeMetrix.papers.toLocaleString()}</b></div><div className="author-citemetrix-formula"><span>Calculation</span><p><strong>Total citations to publications</strong><i/><strong>Total publications</strong></p></div></div></div><p className="author-metric-note"><i className="bi bi-info-circle"/> CiteMetrix uses the same rolling three-year window as the resource database. A score of zero is shown when no qualifying indexed publication is available.</p></section>}
        {activeTab === "collaborators" && <section className="author-analytics-section"><div className="author-tab-heading"><span className="eyebrow">Research network</span><h2>Collaborators</h2><p>Authors who share indexed publications with {authorName}.</p></div>{analytics.collaborators.length ? <><CollaboratorPieChart collaborators={analytics.collaborators}/><h3 className="collaborator-list-heading">Collaborator profiles</h3><div className="author-collaborator-grid">{analytics.collaborators.map((collaborator, index) => <Link to={`/indexing-db/authors/${collaborator.id}`} key={collaborator.id}><span>{index + 1}</span><div><b>{[collaborator.salutation, collaborator.name].filter(Boolean).join(" ")}</b><small>{collaborator.papers} shared paper{collaborator.papers === 1 ? "" : "s"}</small></div><i className="bi bi-arrow-right"/></Link>)}</div></> : <div className="author-tab-empty"><i className="bi bi-people"/>No linked collaborator profiles are available.</div>}</section>}
        {activeTab === "areas" && <section className="author-analytics-section"><div className="author-tab-heading"><span className="eyebrow">Subject distribution</span><h2>Research Areas</h2><p>Subject areas derived from the resources containing this author’s indexed papers.</p></div>{analytics.researchAreas.length ? <div className="author-area-list">{analytics.researchAreas.map((area) => <article key={area.name}><div><b>{area.name}</b><span>{area.papers} paper{area.papers === 1 ? "" : "s"}</span></div><div><i style={{ width: `${area.papers / maximumAreaPapers * 100}%` }}/></div></article>)}</div> : <div className="author-tab-empty"><i className="bi bi-diagram-3"/>Subject-area metadata is not available for this author’s resources.</div>}</section>}
          </div>
        </div>
      </>}
    </div></section>
  </>;
}
