import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Camera, Clock, MapPin, Upload } from "lucide-react";
import { Button } from "@pmt/ui";
import { attachmentSizeLimit, siteMediaTypes } from "@pmt/shared";

type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type Point = { latitude: number; longitude: number; accuracy: number };
type Visit = {
  id: string;
  punchedInAt: string;
  punchInLocation: Point;
  punchedOutAt: string | null;
  punchOutLocation: Point | null;
  projectIds: string[];
};
type Project = { id: string; code: string; name: string };
type ProjectPage = {
  rows: Project[];
  total: number;
  page: number;
  pageSize: number;
};
const attendance = "workspace/site-attendance";
const pageSize = 50;

function locate(): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(
        new Error(
          "Location requires a supported browser and a secure connection (HTTPS).",
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude, accuracy } }) =>
        resolve({ latitude, longitude, accuracy }),
      ({ code }) =>
        reject(
          new Error(
            code === 1
              ? "Allow location access in your browser settings and try again."
              : "Could not get your location. Check your device location settings and try again.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

function PunchDetails({
  label,
  value,
  point,
}: {
  label: string;
  value: string;
  point: Point;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <time dateTime={value}>
          {new Date(value).toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
        <small>
          <MapPin size={13} aria-hidden="true" />
          {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
          {" · "}±{Math.round(point.accuracy)} m
        </small>
      </dd>
    </div>
  );
}

export default function SiteEngineerDashboard({
  api,
  canUpload,
  onOpenDocuments,
}: {
  api: Api;
  canUpload: boolean;
  onOpenDocuments: (id: string) => void;
}) {
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [error, setError] = useState("");
  const [uploadResult, setUploadResult] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [projects, setProjects] = useState<ProjectPage | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const active = !!visit && !visit.punchedOutAt;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api(attendance);
      setVisit(data.visit);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadProjects = useCallback(
    async (page: number) => {
      setProjectsLoading(true);
      setProjectsError("");
      try {
        const result: ProjectPage = await api(
          `projects?page=${page}&pageSize=${pageSize}`,
        );
        setProjects((previous) =>
          page > 1 && previous
            ? {
                ...result,
                rows: [
                  ...new Map(
                    [...previous.rows, ...result.rows].map((row) => [
                      row.id,
                      row,
                    ]),
                  ).values(),
                ],
              }
            : result,
        );
      } catch (err) {
        setProjectsError((err as Error).message);
      } finally {
        setProjectsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (active) void loadProjects(1);
  }, [active, loadProjects]);

  async function recordProject() {
    if (!active || !projectId || recording || punching || uploading) return;
    setRecording(true);
    setRecordError("");
    try {
      const data = await api(attendance + "/projects", "POST", {
        visitId: visit.id,
        projectId,
      });
      setVisit(data.visit);
    } catch (err) {
      setRecordError((err as Error).message);
    } finally {
      setRecording(false);
    }
  }

  async function punch() {
    setPunching(true);
    setError("");
    try {
      const point = await locate();
      const data = active
        ? await api(attendance + "/punch-out", "POST", {
            ...point,
            visitId: visit.id,
          })
        : await api(attendance + "/punch-in", "POST", point);
      setVisit(data.visit);
      setProjectId("");
      setRecordError("");
      setProjects(null);
      setFiles([]);
      setUploadResult("");
      setUploadError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPunching(false);
    }
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !active ||
      !projectId ||
      !files.length ||
      punching ||
      uploading ||
      recording
    )
      return;
    const picker = e.currentTarget.querySelector("input[type=file]");
    const base = `projects/${projectId}/documents/`;
    setUploading(true);
    setUploadError("");
    setUploadResult("");
    const failures: string[] = [];
    let uploaded = 0;
    try {
      for (const file of files) {
        try {
          if (!siteMediaTypes.some((type) => type === file.type))
            throw new Error("Unsupported photo or video format");
          if (!file.size || file.size > attachmentSizeLimit(file.type))
            throw new Error("File is empty or exceeds the size limit");
          const authorization = await api(base + "upload", "POST", {
            name: file.name,
            size: file.size,
            mimeType: file.type,
            siteVisitId: visit.id,
          });
          const response = await fetch(authorization.url, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!response.ok) throw new Error("Upload to project storage failed");
          await api(base + `${authorization.id}/complete`, "POST");
          uploaded++;
        } catch (err) {
          failures.push(`${file.name}: ${(err as Error).message}`);
        }
      }
      if (uploaded)
        setUploadResult(
          `${uploaded} ${uploaded === 1 ? "file" : "files"} uploaded and awaiting verification.`,
        );
      setUploadError(failures.join("\n"));
    } finally {
      setFiles([]);
      if (picker instanceof HTMLInputElement) picker.value = "";
      setUploading(false);
    }
  }

  return (
    <div className="site-day">
      <section
        className="card site-day-card"
        aria-labelledby="attendance-heading"
      >
        <div className="site-day-heading">
          <Clock size={20} aria-hidden="true" />
          <h2 id="attendance-heading">Site attendance</h2>
        </div>
        <p aria-live="polite">
          {loading
            ? "Loading attendance…"
            : visit === undefined
              ? "Attendance is unavailable."
              : active
                ? "You’re punched in."
                : visit
                  ? "Your last visit is complete."
                  : "Punch in when you arrive at the site."}
        </p>
        {visit && (
          <dl className="site-punches">
            <PunchDetails
              label="Punch in"
              value={visit.punchedInAt}
              point={visit.punchInLocation}
            />
            {visit.punchedOutAt && visit.punchOutLocation && (
              <PunchDetails
                label="Punch out"
                value={visit.punchedOutAt}
                point={visit.punchOutLocation}
              />
            )}
          </dl>
        )}
        {error && (
          <div className="site-day-message" role="alert">
            {error}
          </div>
        )}
        <div className="site-day-actions">
          {visit !== undefined && (
            <Button
              disabled={loading || punching || uploading || recording}
              onClick={() => void punch()}
            >
              <MapPin size={16} aria-hidden="true" />
              {punching
                ? "Recording punch…"
                : active
                  ? "Punch out"
                  : "Punch in"}
            </Button>
          )}
          {error && (
            <Button
              variant="outline"
              disabled={loading || punching || uploading || recording}
              onClick={() => void refresh()}
            >
              Refresh attendance
            </Button>
          )}
        </div>
        <p>Each punch records the date, time and your device location.</p>
      </section>
      <section className="card site-day-card" aria-labelledby="media-heading">
        <div className="site-day-heading">
          <Camera size={20} aria-hidden="true" />
          <h2 id="media-heading">Project photos and videos</h2>
        </div>
        {!active ? (
          <p>Punch in to upload photos and videos from the site.</p>
        ) : (
          <>
            <p>
              Choose an assigned project to record your visit or upload photos
              and videos.
            </p>
            {projectsError && (
              <div className="site-day-message" role="alert">
                {projectsError}
              </div>
            )}
            {projectsLoading && <p role="status">Loading projects…</p>}
            {projects && !projects.rows.length && (
              <p>No projects are assigned to you yet.</p>
            )}
            {projects?.rows.length ? (
              <form className="site-media-form" onSubmit={upload}>
                <div className="site-media-field">
                  <label htmlFor="site-media-project">Project</label>
                  <select
                    id="site-media-project"
                    value={projectId}
                    disabled={uploading || punching || recording}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setFiles([]);
                      setUploadResult("");
                      setUploadError("");
                      setRecordError("");
                    }}
                  >
                    <option value="">Select a project</option>
                    {projects.rows.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.code} · {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                {projectId && (
                  <div className="site-day-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        uploading ||
                        punching ||
                        recording ||
                        visit.projectIds?.includes(projectId)
                      }
                      onClick={() => void recordProject()}
                    >
                      {recording
                        ? "Recording…"
                        : visit.projectIds?.includes(projectId)
                          ? "Project recorded"
                          : "Record project visit"}
                    </Button>
                  </div>
                )}
                {recordError && (
                  <div className="site-day-message" role="alert">
                    {recordError}
                  </div>
                )}
                {canUpload && projectId && (
                  <div className="site-media-field">
                    <label htmlFor="site-media-files">
                      Site photos and videos
                    </label>
                    <input
                      id="site-media-files"
                      aria-describedby="site-media-formats"
                      key={projectId}
                      type="file"
                      accept={siteMediaTypes.join(",")}
                      multiple
                      disabled={uploading || punching || recording}
                      onChange={(e) =>
                        setFiles(Array.from(e.currentTarget.files ?? []))
                      }
                    />
                    <small id="site-media-formats">
                      JPEG, PNG, WebP up to 10 MB. MP4, MOV, WebM up to 50 MB.
                    </small>
                  </div>
                )}
                <div className="site-day-actions">
                  {canUpload && (
                    <Button
                      type="submit"
                      disabled={
                        !projectId ||
                        !files.length ||
                        uploading ||
                        punching ||
                        recording
                      }
                    >
                      <Upload size={15} aria-hidden="true" />
                      {uploading ? "Uploading…" : "Upload site media"}
                    </Button>
                  )}
                  {projectId && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading || punching || recording}
                      onClick={() => onOpenDocuments(projectId)}
                    >
                      Project documents
                    </Button>
                  )}
                </div>
              </form>
            ) : null}
            {(projectsError ||
              (projects &&
                projects.page * projects.pageSize < projects.total)) && (
              <Button
                variant="outline"
                disabled={projectsLoading || uploading || punching}
                onClick={() => void loadProjects((projects?.page ?? 0) + 1)}
              >
                {projectsError
                  ? "Retry loading projects"
                  : "Load more projects"}
              </Button>
            )}
            {uploadResult && <p role="status">{uploadResult}</p>}
            {uploadError && (
              <div className="site-day-message" role="alert">
                {uploadError}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
