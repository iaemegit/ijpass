import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/auth';
import { toArticleTitleCase, toShortArticleTitle } from '../lib/text';
import './IndexedArticlePage.css';

type Article = { id: number; journalId: number; journalTitle: string; title: string; volume?: string | null; issue?: string | null; publicationYear?: number | null; pages?: string | null; doi?: string | null; doiUrl?: string | null; articleLink?: string | null; abstract?: string | null; keywords?: string | null; apaCitation: string };
type Author = { profileId?: number | null; name: string; designation?: string | null; affiliation?: string | null; country?: string | null; orcid?: string | null };
type Reference = { id: number; number: number; text: string; doi?: string | null; link?: string | null };
type Citation = { id: number; sourceId: number; title: string; journalTitle: string; publicationYear?: number | null; authors: string; matchedReference: string };

function abstractText(value?: string | null) {
  if (!value) return 'Abstract not available.';
  const withLineBreaks = value.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  const document = new DOMParser().parseFromString(withLineBreaks, 'text/html');
  return (document.body.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeHtmlText(value: string) {
  const document = new DOMParser().parseFromString(value, 'text/html');
  return (document.body.textContent || value).replace(/\u00a0/g, ' ').trim();
}

export default function IndexedArticlePage() {
  const { sourceId = '', manuscriptId = '' } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get<{ article: Article; authors: Author[]; references: Reference[]; citations: Citation[] }>(`/journal-index/${sourceId}/articles/${manuscriptId}`, { signal: controller.signal })
      .then(({ data }) => { setArticle(data.article); setAuthors(data.authors); setReferences(data.references); setCitations(data.citations); })
      .catch(error => { if (error.code !== 'ERR_CANCELED') setError(error.response?.status === 404 ? 'The requested indexed article was not found.' : 'The article data could not be loaded. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [manuscriptId, sourceId]);

  if (loading) return <section className="section-space"><div className="container"><div className="journal-index-state"><span className="spinner-border"/> Loading article data…</div></div></section>;
  if (error || !article) return <section className="section-space"><div className="container"><div className="alert alert-danger">{error || 'Article not found.'}</div><Link to={`/indexing-db/resources/${sourceId}`} className="btn btn-outline-success">Back to indexed resource</Link></div></section>;

  const keywords = article.keywords?.split(/[,;]+/).map(value => value.trim()).filter(Boolean) || [];
  return <>
    <section className="page-hero article-data-hero"><div className="container"><div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/indexing-db/resources">Resources</Link><i className="bi bi-chevron-right"/><Link to={`/indexing-db/resources/${sourceId}`}>{article.journalTitle}</Link><i className="bi bi-chevron-right"/><span>Article</span></div><h1>Indexed Article</h1></div></section>
    <section className="section-space article-data-page"><div className="container">
      <article className="article-data-card">
        <div className="article-journal-label"><i className="bi bi-journal-bookmark-fill"/><div><span>Journal title</span><strong>{article.journalTitle}</strong></div></div>
        <h2>{toArticleTitleCase(article.title)}</h2>
        <div className="article-meta-grid article-meta-grid-citations"><div><span>Volume</span><strong>{article.volume || '—'}</strong></div><div><span>Issue</span><strong>{article.issue || '—'}</strong></div><div><span>Published year</span><strong>{article.publicationYear || '—'}</strong></div><div><span>Pages</span><strong>{article.pages || 'Not available in source data'}</strong></div><div className="citation-count-meta"><span>Citations</span><strong>{citations.length.toLocaleString()}</strong></div></div>
        {(article.articleLink || article.doiUrl) && <div className="article-access-actions">{article.articleLink && <a className="btn article-paper-button" href={article.articleLink} target="_blank" rel="noopener noreferrer"><i className="bi bi-file-earmark-text"/> Article Link <i className="bi bi-box-arrow-up-right"/></a>}{article.doiUrl && <a className="btn article-doi-button" href={article.doiUrl} target="_blank" rel="noopener noreferrer" title={article.doi || "Open DOI record"}><i className="bi bi-link-45deg"/> View DOI <i className="bi bi-box-arrow-up-right"/></a>}</div>}
        <section className="article-detail-section"><h3><i className="bi bi-people"/>Authors</h3><div className="article-author-list">{authors.length ? authors.map((author, index) => <div className="article-author" key={`${author.name}-${index}`}><span>{index + 1}</span><div>{author.profileId ? <Link to={`/indexing-db/authors/${author.profileId}`} className="article-author-profile-link"><strong>{author.name}</strong><i className="bi bi-arrow-up-right"/></Link> : <strong>{author.name}</strong>}{author.designation && <p>{author.designation}</p>}{(author.affiliation || author.country) && <p>{[author.affiliation, author.country].filter(Boolean).join(', ')}</p>}{author.orcid && <a href={`https://orcid.org/${author.orcid.replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')}`} target="_blank" rel="noopener noreferrer">ORCID <i className="bi bi-box-arrow-up-right"/></a>}</div></div>) : <p>Author information unavailable.</p>}</div></section>
        <section className="article-detail-section"><h3><i className="bi bi-file-text"/>Abstract</h3><p className="article-abstract">{abstractText(article.abstract)}</p></section>
        <section className="article-detail-section"><h3><i className="bi bi-tags"/>Keywords</h3>{keywords.length ? <div className="article-keywords">{keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div> : <p>Keywords not available.</p>}</section>
        <section className="article-detail-section citation-panel"><h3><i className="bi bi-quote"/>APA citation</h3><p>{article.apaCitation}</p><button type="button" className="btn btn-sm btn-outline-success" onClick={() => void navigator.clipboard.writeText(article.apaCitation)}><i className="bi bi-copy"/> Copy citation</button></section>
        <section className="article-detail-section cited-by-section"><h3><i className="bi bi-diagram-3"/>Cited by <span>{citations.length}</span></h3>{citations.length ? <><div className="article-citation-list">{citations.slice(0, 4).map(citation => <article key={`${citation.id}-${citation.matchedReference}`}><Link to={`/journal-ranking/index/${citation.sourceId}/${citation.id}`} title={toArticleTitleCase(citation.title)}><span>{toShortArticleTitle(citation.title)}</span><i className="bi bi-arrow-right"/></Link></article>)}</div><Link className="show-all-citations" to={`/journal-ranking/index/${sourceId}/${manuscriptId}/citedby`}>Show all Cited by articles <i className="bi bi-arrow-right"/></Link></> : <p>No matching citations were found in the currently indexed reference data.</p>}</section>
        <section className="article-detail-section"><h3><i className="bi bi-list-ol"/>References <span>{references.length}</span></h3>{references.length ? <ol className="article-reference-list">{references.map(reference => <li key={reference.id}><p>{decodeHtmlText(reference.text)}</p>{reference.doi && <a href={/^https?:\/\//i.test(reference.doi) ? reference.doi : `https://doi.org/${reference.doi.replace(/^doi:\s*/i, '')}`} target="_blank" rel="noopener noreferrer">DOI <i className="bi bi-box-arrow-up-right"/></a>}</li>)}</ol> : <p>No references are available for this article.</p>}</section>
      </article>
    </div></section>
  </>;
}
