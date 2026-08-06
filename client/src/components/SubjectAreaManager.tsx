import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/auth";
import AdminPagination from "./AdminPagination";
import AdminTableControls from "./AdminTableControls";

export type SubjectHierarchyKind = "majors" | "classifications" | "subjects";

type Values = {
  majorSubject: string;
  majorSubjectId: string;
  classificationName: string;
  classificationId: string;
  subjectArea: string;
};
type RecordRow = {
  id: number;
  majorSubject?: string;
  majorSubjectId?: number;
  classificationName?: string;
  classificationId?: number;
  subjectArea?: string;
  classificationCount?: number;
  subjectAreaCount?: number;
};
type MajorOption = { id: number; majorSubject: string };
type ClassificationOption = { id: number; majorSubjectId: number; classificationName: string };
type Pagination = { page: number; pageSize: number; totalRecords: number; totalPages: number };

const emptyValues: Values = {
  majorSubject: "",
  majorSubjectId: "",
  classificationName: "",
  classificationId: "",
  subjectArea: "",
};

const formSchema = (kind: SubjectHierarchyKind) => z.object({
  majorSubject: z.string(),
  majorSubjectId: z.string(),
  classificationName: z.string(),
  classificationId: z.string(),
  subjectArea: z.string(),
}).superRefine((values, context) => {
  if (kind === "majors" && values.majorSubject.trim().length < 2) {
    context.addIssue({ code: "custom", path: ["majorSubject"], message: "Enter the major subject" });
  }
  if (kind !== "majors" && !values.majorSubjectId) {
    context.addIssue({ code: "custom", path: ["majorSubjectId"], message: "Select a major subject" });
  }
  if (kind === "classifications" && values.classificationName.trim().length < 2) {
    context.addIssue({ code: "custom", path: ["classificationName"], message: "Enter the classification name" });
  }
  if (kind === "subjects" && !values.classificationId) {
    context.addIssue({ code: "custom", path: ["classificationId"], message: "Select a classification name" });
  }
  if (kind === "subjects" && values.subjectArea.trim().length < 2) {
    context.addIssue({ code: "custom", path: ["subjectArea"], message: "Enter the subject area" });
  }
});

const definitions = {
  majors: {
    singular: "Major Subject",
    plural: "Major Subjects",
    path: "/admin/major-subjects",
    endpoint: "/admin/major-subjects",
    icon: "bi-collection",
    description: "Manage the top-level scholarly subject groups.",
    placeholder: "Search ID or major subject",
    sorts: [{ value: "name", label: "Major Subject A–Z" }, { value: "newest", label: "Newest first" }],
  },
  classifications: {
    singular: "Classification Name",
    plural: "Classification Names",
    path: "/admin/classification-names",
    endpoint: "/admin/subject-classifications",
    icon: "bi-diagram-2",
    description: "Connect each classification name to one major subject.",
    placeholder: "Search ID, major subject, or classification",
    sorts: [{ value: "classification", label: "Classification A–Z" }, { value: "major", label: "Major Subject A–Z" }, { value: "newest", label: "Newest first" }],
  },
  subjects: {
    singular: "Subject Area",
    plural: "Subject Areas",
    path: "/admin/subject-areas",
    endpoint: "/admin/subject-areas",
    icon: "bi-diagram-3",
    description: "Manage subject areas under their major subject and classification.",
    placeholder: "Search ID, major subject, classification, or subject area",
    sorts: [{ value: "subject", label: "Subject Area A–Z" }, { value: "major", label: "Major Subject A–Z" }, { value: "classification", label: "Classification A–Z" }, { value: "newest", label: "Newest first" }],
  },
} as const;

export default function SubjectAreaManager({
  kind = "subjects",
  mode = "list",
}: {
  kind?: SubjectHierarchyKind;
  mode?: "list" | "form";
}) {
  const config = definitions[kind];
  const navigate = useNavigate();
  const location = useLocation();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [majorSubjects, setMajorSubjects] = useState<MajorOption[]>([]);
  const [classifications, setClassifications] = useState<ClassificationOption[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, totalRecords: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<string>(config.sorts[0].value);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const schema = useMemo(() => formSchema(kind), [kind]);
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues,
  });
  const selectedMajorId = watch("majorSubjectId");
  const availableClassifications = classifications.filter((record) => String(record.majorSubjectId) === selectedMajorId);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return api.get<{ records: RecordRow[]; pagination: Pagination }>(config.endpoint, {
      params: { q: debouncedQuery, page, sort },
    }).then(({ data }) => {
      setRecords(data.records);
      setPagination(data.pagination);
      if (data.pagination.page !== page) setPage(data.pagination.page);
    }).catch(() => setError(`Unable to load ${config.plural.toLocaleLowerCase()}.`))
      .finally(() => setLoading(false));
  }, [config.endpoint, config.plural, debouncedQuery, page, sort]);

  useEffect(() => { if (mode === "list") void load(); }, [load, mode]);

  useEffect(() => {
    if (mode !== "form") return;
    const id = Number(new URLSearchParams(location.search).get("edit"));
    setError("");
    setLoading(true);
    const optionsRequest = kind === "majors"
      ? Promise.resolve({ data: { majorSubjects: [], classifications: [] } })
      : api.get<{ majorSubjects: MajorOption[]; classifications: ClassificationOption[] }>("/admin/subject-hierarchy/options");
    const detailRequest = id ? api.get<{ record: RecordRow }>(`${config.endpoint}/${id}`) : Promise.resolve(null);
    Promise.all([optionsRequest, detailRequest]).then(([options, detail]) => {
      setMajorSubjects(options.data.majorSubjects);
      setClassifications(options.data.classifications);
      setEditingId(id || null);
      if (!detail) {
        reset(emptyValues);
        return;
      }
      const record = detail.data.record;
      reset({
        majorSubject: record.majorSubject || "",
        majorSubjectId: record.majorSubjectId ? String(record.majorSubjectId) : "",
        classificationName: record.classificationName || "",
        classificationId: record.classificationId ? String(record.classificationId) : "",
        subjectArea: record.subjectArea || "",
      });
    }).catch(() => setError(`Unable to load this ${config.singular.toLocaleLowerCase()} record.`))
      .finally(() => setLoading(false));
  }, [config.endpoint, config.singular, kind, location.search, mode, reset]);

  const submit = async (values: Values) => {
    setError("");
    const payload = kind === "majors"
      ? { majorSubject: values.majorSubject.trim() }
      : kind === "classifications"
        ? { majorSubjectId: Number(values.majorSubjectId), classificationName: values.classificationName.trim() }
        : { classificationId: Number(values.classificationId), subjectArea: values.subjectArea.trim() };
    try {
      if (editingId) await api.put(`${config.endpoint}/${editingId}`, payload);
      else await api.post(config.endpoint, payload);
      navigate(config.path);
    } catch (requestError) {
      setError((requestError as { response?: { data?: { message?: string } } }).response?.data?.message || `Unable to save the ${config.singular.toLocaleLowerCase()} record.`);
    }
  };

  const majorSelect = register("majorSubjectId");

  return <section>
    <div className="manager-heading"><div><span className="eyebrow">Subject Area Data</span><h2>{mode === "form" ? editingId ? `Edit ${config.singular}` : `Add ${config.singular}` : config.plural}</h2><p>{config.description}</p></div>{mode === "list" ? <button className="btn btn-primary" onClick={() => navigate(`${config.path}/addnew`)}><i className="bi bi-plus-lg me-2"/>Add New</button> : <button className="btn btn-outline-secondary" onClick={() => navigate(config.path)}><i className="bi bi-arrow-left me-2"/>Back to list</button>}</div>

    {mode === "form" && <div className="admin-form-card"><div className="admin-panel-heading"><span className="form-icon"><i className={`bi ${config.icon}`}/></span><div><h2>{editingId ? "Edit" : "Create"} {config.singular}</h2><p>{kind === "majors" ? "Enter the top-level subject name." : kind === "classifications" ? "Select the parent major subject, then enter the classification name." : "Select the hierarchy, then enter one subject area."}</p></div></div>
      {loading ? <div className="text-center py-5"><span className="spinner-border spinner-border-sm me-2"/>Loading record…</div> : <form onSubmit={handleSubmit(submit)} noValidate autoComplete="off"><div className="row g-3">
        {editingId && <div className="col-md-3"><label>{config.singular} ID</label><input className="form-control" value={editingId} readOnly aria-readonly="true"/></div>}
        {kind === "majors" && <div className={editingId ? "col-md-9" : "col-12"}><label>Major Subject</label><input className={`form-control ${errors.majorSubject ? "is-invalid" : ""}`} placeholder="Example: Health Sciences" autoComplete="off" {...register("majorSubject")}/><div className="invalid-feedback">{errors.majorSubject?.message}</div></div>}
        {kind !== "majors" && <div className={editingId ? "col-md-9" : "col-md-6"}><label>Major Subject</label><select className={`form-select ${errors.majorSubjectId ? "is-invalid" : ""}`} {...majorSelect} onChange={(event) => { void majorSelect.onChange(event); if (kind === "subjects") setValue("classificationId", "", { shouldValidate: true }); }}><option value="">Select major subject</option>{majorSubjects.map((record) => <option key={record.id} value={record.id}>{record.majorSubject}</option>)}</select><div className="invalid-feedback">{errors.majorSubjectId?.message}</div></div>}
        {kind === "classifications" && <div className="col-md-6"><label>Classification Name</label><input className={`form-control ${errors.classificationName ? "is-invalid" : ""}`} placeholder="Example: Medicine" autoComplete="off" {...register("classificationName")}/><div className="invalid-feedback">{errors.classificationName?.message}</div></div>}
        {kind === "subjects" && <><div className="col-md-6"><label>Classification Name</label><select className={`form-select ${errors.classificationId ? "is-invalid" : ""}`} disabled={!selectedMajorId} {...register("classificationId")}><option value="">{selectedMajorId ? "Select classification name" : "Select a major subject first"}</option>{availableClassifications.map((record) => <option key={record.id} value={record.id}>{record.classificationName}</option>)}</select><div className="invalid-feedback">{errors.classificationId?.message}</div></div><div className="col-12"><label>Subject Area</label><input className={`form-control ${errors.subjectArea ? "is-invalid" : ""}`} placeholder="Example: Neurology (clinical)" autoComplete="off" {...register("subjectArea")}/><div className="invalid-feedback">{errors.subjectArea?.message}</div></div></>}
        <div className="col-12">{error && <div className="alert alert-danger py-2">{error}</div>}<div className="d-flex justify-content-end gap-2"><button type="button" className="btn btn-outline-secondary" onClick={() => navigate(config.path)}>Cancel</button><button className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving…" : editingId ? `Update ${config.singular}` : `Save ${config.singular}`} <i className="bi bi-check2 ms-2"/></button></div></div>
      </div></form>}
    </div>}

    {mode === "list" && <div className="users-table-card"><div className="table-title admin-list-title"><h3>{config.singular} List</h3><AdminTableControls query={query} onQueryChange={setQuery} placeholder={config.placeholder} sort={sort} onSortChange={(value) => { setSort(value); setPage(1); }} options={[...config.sorts]}/><span>{pagination.totalRecords.toLocaleString()} records</span></div>{error && <div className="alert alert-danger m-3">{error}</div>}<div className="table-responsive"><table className="table align-middle"><thead><tr><th>Sl. No.</th><th>ID</th>{kind !== "majors" && <th>Major Subject</th>}{kind === "majors" && <th>Major Subject</th>}{kind !== "majors" && <th>Classification Name</th>}{kind === "subjects" && <th>Subject Area</th>}{kind === "majors" && <><th>Classifications</th><th>Subject Areas</th></>}{kind === "classifications" && <th>Subject Areas</th>}<th>Actions</th></tr></thead><tbody>
      {loading && <tr><td colSpan={6} className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2"/>Loading {config.plural.toLocaleLowerCase()}…</td></tr>}
      {!loading && !records.length && <tr><td colSpan={6} className="text-center text-muted py-4">{debouncedQuery ? `No ${config.plural.toLocaleLowerCase()} match your search.` : `No ${config.plural.toLocaleLowerCase()} found.`}</td></tr>}
      {!loading && records.map((record, index) => <tr key={record.id}><td>{(pagination.page - 1) * pagination.pageSize + index + 1}</td><td><code>{record.id}</code></td>{kind === "majors" ? <><td><b>{record.majorSubject}</b></td><td>{record.classificationCount?.toLocaleString() || 0}</td><td>{record.subjectAreaCount?.toLocaleString() || 0}</td></> : <><td><b>{record.majorSubject}</b></td><td>{record.classificationName}</td>{kind === "subjects" ? <td>{record.subjectArea}</td> : <td>{record.subjectAreaCount?.toLocaleString() || 0}</td>}</>}<td><button className="btn btn-sm btn-outline-primary" title="Edit" onClick={() => navigate(`${config.path}/addnew?edit=${record.id}`)}><i className="bi bi-pencil"/></button></td></tr>)}
    </tbody></table></div><AdminPagination total={pagination.totalRecords} page={pagination.page} onPageChange={setPage}/></div>}
  </section>;
}
