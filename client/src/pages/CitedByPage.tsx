import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/auth';
import { toArticleTitleCase } from '../lib/text';
import './CitedByPage.css';

type Article = { id: number; journalTitle: string; title: string };
type Citation = { id: number; sourceId: number; title: string; journalTitle: string; publicationYear?: number | null; authors: string };

export default function CitedByPage() {
  const { sourceId = '', manuscriptId = '' } = useParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get<{ article: Article; citations: Citation[] }>(`/journal-index/${sourceId}/articles/${manuscriptId}`, { signal: controller.signal })
      .then(({ data }) => { setArticle(data.article); setCitations(data.citations); })
      .catch(requestError => { if (requestError.code !== 'ERR_CANCELED') setError('The cited-by articles could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sourceId, manuscriptId]);

  if (loading) return <section className="section-space"><div className="container"><div className="journal-index-state"><span className="spinner-border"/> Loading citations...</div></div></section>;
  if (error || !article) return <section className="section-space"><div className="container"><div className="alert alert-danger">{error || 'Article not found.'}</div></div></section>;

  return <>
    <section className="page-hero article-data-hero"><div className="container"><div className="breadcrumb-line"><Link to="/">Home</Link><i className="bi bi-chevron-right"/><Link to="/journal-ranking/index">Journal Index</Link><i className="bi bi-chevron-right"/><Link to={`/journal-ranking/index/${sourceId}/${manuscriptId}`}>Article</Link><i className="bi bi-chevron-right"/><span>Cited by</span></div><h1>Cited by Articles</h1></div></section>
    <section className="section-space cited-by-page"><div className="container"><div className="cited-by-page-card"><div className="cited-by-source"><span>Source article</span><h2>{toArticleTitleCase(article.title)}</h2><p>{article.journalTitle}</p></div><div className="cited-by-page-heading"><h3>Articles citing this work</h3><span>{citations.length}</span></div>{citations.length ? <div className="cited-by-full-list">{citations.map((citation, index) => <article key={`${citation.sourceId}-${citation.id}`}><span>{index + 1}</span><div><Link to={`/journal-ranking/index/${citation.sourceId}/${citation.id}`}>{toArticleTitleCase(citation.title)} <i className="bi bi-arrow-up-right"/></Link>{citation.authors && <p>{citation.authors}</p>}<small>{citation.journalTitle}{citation.publicationYear ? ` · ${citation.publicationYear}` : ''}</small></div></article>)}</div> : <div className="alert alert-light">No matching citations were found.</div>}</div></div></section>
  </>;
}
