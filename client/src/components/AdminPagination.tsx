import { useEffect } from 'react';

export const ADMIN_PAGE_SIZE = 20;

export const pageSlice = <T,>(items: T[], page: number) => items.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE);

export default function AdminPagination({ total, page, onPageChange }: { total: number; page: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  useEffect(() => { if (page > pageCount) onPageChange(pageCount); }, [onPageChange, page, pageCount]);
  if (total <= ADMIN_PAGE_SIZE) return null;

  const pageNumbers = Array.from(new Set([1, pageCount, page - 2, page - 1, page, page + 1, page + 2].filter(value => value >= 1 && value <= pageCount))).sort((a, b) => a - b);
  const controls: Array<number | 'ellipsis'> = [];
  pageNumbers.forEach((value, index) => {
    if (index && value - pageNumbers[index - 1] > 1) controls.push('ellipsis');
    controls.push(value);
  });
  const first = (page - 1) * ADMIN_PAGE_SIZE + 1;
  const last = Math.min(page * ADMIN_PAGE_SIZE, total);

  return <div className="admin-pagination-wrap">
    <small>Showing {first}–{last} of {total}</small>
    <nav aria-label="Table pagination"><ul className="pagination pagination-sm mb-0">
      <li className={`page-item ${page === 1 ? 'disabled' : ''}`}><button type="button" className="page-link" onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Previous page"><i className="bi bi-chevron-left"/></button></li>
      {controls.map((control, index) => control === 'ellipsis'
        ? <li className="page-item disabled" key={`ellipsis-${index}`}><span className="page-link">…</span></li>
        : <li className={`page-item ${page === control ? 'active' : ''}`} key={control}><button type="button" className="page-link" onClick={() => onPageChange(control)} aria-current={page === control ? 'page' : undefined}>{control}</button></li>)}
      <li className={`page-item ${page === pageCount ? 'disabled' : ''}`}><button type="button" className="page-link" onClick={() => onPageChange(page + 1)} disabled={page === pageCount} aria-label="Next page"><i className="bi bi-chevron-right"/></button></li>
    </ul></nav>
  </div>;
}
