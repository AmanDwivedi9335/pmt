import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@pmt/ui";
import { attendanceTimeZone } from "@pmt/shared";

type Period = "daily" | "monthly";
type Filters = {
  period: Period;
  date: string;
  projectId: string;
  search: string;
};
type Project = { id: string; code: string; name: string };
type Point = { latitude: number; longitude: number; accuracy: number };
type Totals = {
  visits: number;
  open: number;
  photos: number;
  videos: number;
  pending: number;
  rejected: number;
};
type Visit = {
  id: string;
  punchedInAt: string;
  punchedOutAt: string | null;
  punchInLocation: Point;
  punchOutLocation: Point | null;
  files: { id: string; name: string; status: string }[];
};
type Report = {
  projects: Project[];
  rows: {
    employee: {
      id: string;
      name: string;
      email: string;
      role: string;
      active: boolean;
    };
    project: Project | null;
    totals: Totals;
    visits: Visit[];
  }[];
  totals: Totals & { employees: number };
  page: number;
  pageSize: number;
  total: number;
};

const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: attendanceTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timestamp = new Intl.DateTimeFormat("en-IN", {
  timeZone: attendanceTimeZone,
  dateStyle: "medium",
  timeStyle: "short",
});
const mediaStatus: Record<string, string> = {
  CLEAN: "Verified",
  QUARANTINED: "Pending verification",
  REJECTED: "Rejected",
};

function today() {
  const parts = Object.fromEntries(
    calendar.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function Punch({ value, point }: { value: string; point?: Point | null }) {
  return (
    <>
      <time dateTime={value}>{timestamp.format(new Date(value))}</time>
      {point && (
        <small>
          {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · ±
          {Math.round(point.accuracy)} m
        </small>
      )}
    </>
  );
}

function VisitDetails({ visit }: { visit: Visit }) {
  return (
    <li className="attendance-visit">
      <dl>
        <div>
          <dt>Punch in</dt>
          <dd>
            <Punch value={visit.punchedInAt} point={visit.punchInLocation} />
          </dd>
        </div>
        <div>
          <dt>Punch out</dt>
          <dd>
            {visit.punchedOutAt ? (
              <Punch
                value={visit.punchedOutAt}
                point={visit.punchOutLocation}
              />
            ) : (
              "Open visit"
            )}
          </dd>
        </div>
      </dl>
      {visit.files.length ? (
        <ul className="attendance-files">
          {visit.files.map((file) => (
            <li key={file.id}>
              <span>{file.name}</span>
              <small>{mediaStatus[file.status] ?? file.status}</small>
            </li>
          ))}
        </ul>
      ) : (
        <small>No uploads for this project on this visit.</small>
      )}
    </li>
  );
}

export default function AttendanceReport({
  api,
  onOpenDocuments,
}: {
  api: (path: string) => Promise<Report>;
  onOpenDocuments: (id: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>(() => ({
    period: "daily",
    date: today(),
    projectId: "",
    search: "",
  }));
  const [request, setRequest] = useState(() => ({ filters, page: 1 }));
  const [result, setResult] = useState<Report | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const { period, date, projectId, search } = request.filters;
    const query = new URLSearchParams({
      period,
      date: period === "monthly" ? date.slice(0, 7) + "-01" : date,
      search,
      page: String(request.page),
    });
    if (projectId) query.set("projectId", projectId);
    void api(`organizations/attendance-report?${query}`)
      .then((data) => {
        if (!current) return;
        setResult(data);
        setProjects(data.projects);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, request]);

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRequest({ filters, page: 1 });
  }

  return (
    <div className="attendance-report">
      <form className="card attendance-filters" onSubmit={apply}>
        <label>
          Period
          <select
            value={filters.period}
            onChange={(e) => {
              const period = e.target.value as Period;
              setFilters({
                ...filters,
                period,
                date:
                  period === "monthly"
                    ? filters.date.slice(0, 7)
                    : filters.date.slice(0, 7) + "-01",
              });
            }}
          >
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>
          {filters.period === "daily" ? "Date" : "Month"}
          <input
            type={filters.period === "daily" ? "date" : "month"}
            required
            value={filters.date}
            onChange={(e) => setFilters({ ...filters, date: e.target.value })}
          />
        </label>
        <label htmlFor="attendance-project">
          Project
          <select
            id="attendance-project"
            value={filters.projectId}
            onChange={(e) =>
              setFilters({ ...filters, projectId: e.target.value })
            }
          >
            <option value="">All projects</option>
            <option value="unlinked">No linked project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Employee
          <input
            type="search"
            maxLength={150}
            placeholder="Name or email"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </label>
        <Button type="submit">Apply filters</Button>
      </form>
      <p className="muted attendance-note">
        Visits and their uploads are grouped by punch-in date in India Standard
        Time. A visit linked to several projects counts once in the overall
        visit totals.
      </p>
      {loading ? (
        <p className="empty" role="status">
          Loading attendance report…
        </p>
      ) : error ? (
        <div className="notice" role="alert">
          {error}{" "}
          <Button variant="outline" onClick={() => setRequest({ ...request })}>
            Retry
          </Button>
        </div>
      ) : (
        result && (
          <>
            <div className="attendance-totals" aria-label="Report totals">
              {[
                ["Employees", result.totals.employees],
                ["Visits", result.totals.visits],
                ["Open visits", result.totals.open],
                ["Photos", result.totals.photos],
                ["Videos", result.totals.videos],
              ].map(([label, value]) => (
                <div className="card" key={label}>
                  <span className="muted">{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="muted attendance-note">
              Upload checks: {result.totals.pending} pending verification ·{" "}
              {result.totals.rejected} rejected. Counts include uploads received
              by storage.
            </p>
            {result.rows.length ? (
              <div className="table-card attendance-table">
                <table aria-label="Employee attendance by project">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Project</th>
                      <th scope="col">First punch in</th>
                      <th scope="col">Last visit punch out</th>
                      <th scope="col">Visits</th>
                      <th scope="col">Photos</th>
                      <th scope="col">Videos</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map(
                      ({ employee, project, totals, visits }) => {
                        const first = visits[0];
                        const last = visits.at(-1);
                        return (
                          <tr
                            key={`${employee.id}:${project?.id ?? "unlinked"}`}
                          >
                            <th scope="row">
                              <b>{employee.name}</b>
                              <small>{employee.email}</small>
                              <small>
                                {employee.role.replaceAll("_", " ")}
                                {employee.active ? "" : " · Inactive"}
                              </small>
                            </th>
                            <td>
                              {project ? (
                                <>
                                  <b>{project.name}</b>
                                  <small>{project.code}</small>
                                </>
                              ) : (
                                "No linked project"
                              )}
                            </td>
                            <td>
                              {first ? (
                                <Punch value={first.punchedInAt} />
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              {last?.punchedOutAt ? (
                                <Punch value={last.punchedOutAt} />
                              ) : last ? (
                                "Open visit"
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              {totals.visits}
                              {totals.open > 0 && (
                                <small>{totals.open} open</small>
                              )}
                            </td>
                            <td>{totals.photos}</td>
                            <td>{totals.videos}</td>
                            <td>
                              {visits.length ? (
                                <details>
                                  <summary>
                                    View{" "}
                                    {visits.length === 1
                                      ? "visit"
                                      : `${visits.length} visits`}
                                  </summary>
                                  <ul className="attendance-visits">
                                    {visits.map((visit) => (
                                      <VisitDetails
                                        key={visit.id}
                                        visit={visit}
                                      />
                                    ))}
                                  </ul>
                                  {project &&
                                    (totals.photos > 0 ||
                                      totals.videos > 0) && (
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          onOpenDocuments(project.id)
                                        }
                                      >
                                        Project documents
                                      </Button>
                                    )}
                                </details>
                              ) : (
                                <span className="muted">
                                  No recorded activity
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">
                No employees or visits match these filters.
              </p>
            )}
            {result.total > result.pageSize && (
              <div className="attendance-pages">
                <Button
                  variant="outline"
                  disabled={result.page === 1}
                  onClick={() =>
                    setRequest({ ...request, page: result.page - 1 })
                  }
                >
                  Previous
                </Button>
                <span>
                  Page {result.page} of{" "}
                  {Math.ceil(result.total / result.pageSize)}
                </span>
                <Button
                  variant="outline"
                  disabled={result.page * result.pageSize >= result.total}
                  onClick={() =>
                    setRequest({ ...request, page: result.page + 1 })
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
