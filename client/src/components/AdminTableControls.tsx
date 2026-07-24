type SortOption = { value: string; label: string };

export default function AdminTableControls({ query, onQueryChange, placeholder, sort, onSortChange, options }: { query: string; onQueryChange: (value: string) => void; placeholder: string; sort: string; onSortChange: (value: string) => void; options: SortOption[] }) {
  return <div className="admin-table-controls">
    <div className="admin-table-search"><i className="bi bi-search"/><input type="search" value={query} onChange={event => onQueryChange(event.target.value)} placeholder={placeholder} aria-label={placeholder}/></div>
    <select className="form-select form-select-sm" value={sort} onChange={event => onSortChange(event.target.value)} aria-label="Sort records">{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
  </div>;
}
