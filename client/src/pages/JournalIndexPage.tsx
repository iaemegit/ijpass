import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/auth';

type JournalRecord = { id: number; title: string; articleCount: number; citationCount: number };
type Pagination = { page: number; pageSize: number; totalRecords: number; totalPages: number };

const initialPagination: Pagination = { page: 1, pageSize: 20, totalRecords: 0, totalPages: 1 };

export default function JournalIndexPage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [journals, setJournals] = useState<JournalRecord[]>([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api.get<{ journals: JournalRecord[]; pagination: Pagination }>('/journal-index', {
        params: { q: query.trim() || undefined, page },
        signal: controller.signal
      }).then(({ data }) => {
        setJournals(data.journals);
        setPagination(data.pagination);
        if (data.pagination.page !== page) setPage(data.pagination.page);
      }).catch(error => {
        if (error.code !== 'ERR_CANCELED') setError('The journal index could not be loaded. Please try again.');
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, query]);

  useEffect(() => {
    if (!suggestionsEnabled || query.trim().length < 2) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.get<{ suggestions: string[] }>('/journal-index/suggestions', { params: { q: query.trim() }, signal: controller.signal })
        .then(({ data }) => setSuggestions(data.suggestions || []))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, suggestionsEnabled]);

  const changeQuery = (value: string) => { setQuery(value); setPage(1); setSuggestionsEnabled(true); };
  const pages = Array.from({ length: Math.min(5, pagination.totalPages) }, (_, index) => {
    const start = Math.max(1, Math.min(pagination.page - 2, pagination.totalPages - 4));
    return start + index;
  });

  return <>
    <section className="page-hero"><div className="container">
      <div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/journal-ranking">Journal Ranking</Link><i className="bi bi-chevron-right"/><span>Journal Index</span></div>
      <span className="eyebrow-light">Indexed Sources</span><h1>Journal Index</h1>
      <p>Browse source titles and the number of articles currently indexed in the IJPAss journal database.</p>
    </div></section>
    <section className="section-space journal-index-page"><div className="container">
      <div className="journal-index-toolbar">
        <div><span className="eyebrow">Journal directory</span><h2>Explore indexed <span>sources.</span></h2><p>{pagination.totalRecords.toLocaleString()} journal titles available.</p></div>
        <div className="journal-index-search"><i className="bi bi-search"/><input type="search" value={query} onChange={event => changeQuery(event.target.value)} placeholder="Search source titles" aria-label="Search source titles" autoComplete="off" aria-autocomplete="list" aria-expanded={suggestions.length > 0}/>{query && <button type="button" onClick={() => { changeQuery(''); setSuggestions([]); }} aria-label="Clear search"><i className="bi bi-x-lg"/></button>}{suggestions.length > 0 && <div className="search-autocomplete-menu" role="listbox">{suggestions.map((title) => <button type="button" key={title} role="option" onClick={() => { setQuery(title); setPage(1); setSuggestions([]); setSuggestionsEnabled(false); }}><i className="bi bi-journal-text"/><span>{title}</span></button>)}</div>}</div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="journal-index-table-wrap">
        <div className="table-responsive">
          <table className="table journal-index-table align-middle mb-0">
            <thead><tr><th scope="col">Source titles</th><th scope="col" className="text-center">Number of articles indexed</th><th scope="col" className="text-center">Number of citations</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={3}><div className="journal-index-state"><span className="spinner-border spinner-border-sm"/> Loading journal data…</div></td></tr>}
              {!loading && !journals.length && <tr><td colSpan={3}><div className="journal-index-state"><i className="bi bi-journal-x"/> No source titles match your search.</div></td></tr>}
              {!loading && journals.map(journal => <tr key={journal.id}><td><span className="journal-source-icon"><i className="bi bi-journal-text"/></span><Link className="journal-source-link" to={`/indexing-db/resources/${journal.id}`} target="_blank" rel="noopener noreferrer">{journal.title}<i className="bi bi-box-arrow-up-right"/></Link></td><td className="text-center"><span className="article-count-badge">{journal.articleCount.toLocaleString()}</span></td><td className="text-center"><span className={`citation-table-badge ${journal.citationCount ? 'has-citations' : ''}`}><i className="bi bi-quote"/>{journal.citationCount.toLocaleString()}</span></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && pagination.totalPages > 1 && <nav className="journal-index-pagination" aria-label="Journal index pages"><ul className="pagination justify-content-center mb-0">
        <li className={`page-item ${pagination.page === 1 ? 'disabled' : ''}`}><button className="page-link" onClick={() => setPage(current => Math.max(1, current - 1))} aria-label="Previous page"><i className="bi bi-chevron-left"/></button></li>
        {pages.map(pageNumber => <li className={`page-item ${pageNumber === pagination.page ? 'active' : ''}`} key={pageNumber}><button className="page-link" onClick={() => setPage(pageNumber)}>{pageNumber}</button></li>)}
        <li className={`page-item ${pagination.page === pagination.totalPages ? 'disabled' : ''}`}><button className="page-link" onClick={() => setPage(current => Math.min(pagination.totalPages, current + 1))} aria-label="Next page"><i className="bi bi-chevron-right"/></button></li>
      </ul></nav>}
    </div></section>
  </>;
}
