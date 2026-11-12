import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { attendanceTimeZone, day, uuid, z } from "@pmt/shared";
import type { Request } from "express";
import { Db } from "./db";
import { parse, Security } from "./security";

const querySchema = z.object({
  period: z.enum(["daily", "monthly"]),
  date: day,
  projectId: z.union([uuid, z.literal("unlinked")]).optional(),
  search: z.string().trim().max(150).default(""),
  page: z.coerce.number().int().min(1).default(1),
});

const pageSize = 25;
const indiaOffset = 330 * 60_000;

function periodBounds(date: string, period: "daily" | "monthly") {
  const first = period === "monthly" ? date.slice(0, 7) + "-01" : date;
  const start = new Date(first + "T00:00:00.000Z");
  const end = new Date(start);
  if (period === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 1);
  return {
    gte: new Date(start.getTime() - indiaOffset),
    lt: new Date(end.getTime() - indiaOffset),
  };
}

async function inBatches<T>(
  ids: string[],
  read: (ids: string[]) => Promise<T[]>,
) {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    for (const result of await read(ids.slice(i, i + 500)))
      results.push(result);
  }
  return results;
}

type Media = { id: string; name: string; mimeType: string; status: string };
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
  punchedInAt: Date;
  punchedOutAt: Date | null;
  punchInLocation: unknown;
  punchOutLocation: unknown;
  files: Media[];
};
type Row = {
  employee: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
  };
  project: { id: string; code: string; name: string } | null;
  totals: Totals;
  visits: Visit[];
};

function emptyTotals(): Totals {
  return { visits: 0, open: 0, photos: 0, videos: 0, pending: 0, rejected: 0 };
}

function countMedia(totals: Totals, files: Media[]) {
  for (const file of files) {
    if (file.mimeType.startsWith("image/")) totals.photos++;
    else if (file.mimeType.startsWith("video/")) totals.videos++;
    if (file.status === "QUARANTINED") totals.pending++;
    else if (file.status === "REJECTED") totals.rejected++;
  }
}

@ApiTags("Attendance reports")
@Controller("organizations/attendance-report")
export class AttendanceReportsController {
  constructor(
    @Inject(Db) readonly db: Db,
    @Inject(Security) readonly security: Security,
  ) {}

  @Get() async report(@Req() req: Request, @Query() query: unknown) {
    const { orgId } = await this.security.context(req, "organization.manage");
    const { period, date, projectId, search, page } = parse(querySchema, query);
    const [projects, staff] = await Promise.all([
      this.db.project.findMany({
        where: { orgId },
        select: { id: true, code: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      this.db.membership.findMany({
        where: {
          orgId,
          ...(search && {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }),
        },
        select: {
          id: true,
          active: true,
          user: { select: { id: true, name: true, email: true } },
          role: { select: { name: true } },
          projectAccess: { where: { orgId }, select: { projectId: true } },
        },
        orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
      }),
    ]);
    const bounds = periodBounds(date, period);
    const visitFilter = { orgId, punchedInAt: bounds };
    const visits = search
      ? await inBatches(
          staff.map(({ id }) => id),
          (ids) =>
            this.db.siteVisit.findMany({
              where: { ...visitFilter, membershipId: { in: ids } },
            }),
        )
      : await this.db.siteVisit.findMany({ where: visitFilter });
    visits.sort(
      (a, b) =>
        a.punchedInAt.getTime() - b.punchedInAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    const documents = await inBatches(
      visits.map(({ id }) => id),
      (ids) =>
        this.db.document.findMany({
          where: { orgId, siteVisitId: { in: ids } },
          select: {
            id: true,
            name: true,
            mimeType: true,
            status: true,
            projectId: true,
            siteVisitId: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
    );
    // Presigned URLs create a document before bytes arrive. The scan job is
    // created only after storage confirms the upload and remains after scanning.
    const pendingKeys = documents
      .filter(({ status }) => status === "QUARANTINED")
      .map(({ id }) => `scan:${id}`);
    const queued = new Set(
      (
        await inBatches(pendingKeys, (keys) =>
          this.db.outbox.findMany({
            where: { orgId, kind: "SCAN", dedupeKey: { in: keys } },
            select: { dedupeKey: true },
          }),
        )
      ).map(({ dedupeKey }) => dedupeKey),
    );
    const mediaByVisit = new Map<string, Map<string, Media[]>>();
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    for (const {
      siteVisitId,
      projectId: documentProject,
      ...file
    } of documents) {
      if (!siteVisitId || !projectById.has(documentProject)) continue;
      if (
        !file.mimeType.startsWith("image/") &&
        !file.mimeType.startsWith("video/")
      )
        continue;
      if (file.status === "QUARANTINED" && !queued.has(`scan:${file.id}`))
        continue;
      const byProject =
        mediaByVisit.get(siteVisitId) ?? new Map<string, Media[]>();
      const files = byProject.get(documentProject) ?? [];
      files.push(file);
      byProject.set(documentProject, files);
      mediaByVisit.set(siteVisitId, byProject);
    }

    const visitsByMember = new Map<string, typeof visits>();
    for (const visit of visits) {
      const owned = visitsByMember.get(visit.membershipId) ?? [];
      owned.push(visit);
      visitsByMember.set(visit.membershipId, owned);
    }
    const rows: Row[] = [];
    const totals = emptyTotals();
    let employees = 0;
    for (const member of staff) {
      const employee = {
        id: member.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role.name,
        active: member.active,
      };
      const employeeRows = new Map<string, Row>();
      function getRow(key: string) {
        if (projectId && projectId !== key) return;
        const project = projectById.get(key);
        if (key !== "unlinked" && !project) return;
        let row = employeeRows.get(key);
        if (!row) {
          row = {
            employee,
            project: project ?? null,
            totals: emptyTotals(),
            visits: [],
          };
          employeeRows.set(key, row);
        }
        return row;
      }
      for (const assignment of member.projectAccess)
        getRow(assignment.projectId);
      if (!member.projectAccess.length && !visitsByMember.has(member.id))
        getRow("unlinked");
      for (const {
        membershipId: _member,
        orgId: _org,
        projectIds,
        ...visit
      } of visitsByMember.get(member.id) ?? []) {
        const media = mediaByVisit.get(visit.id);
        const linked = new Set([
          ...(projectIds ?? []).filter((id) => projectById.has(id)),
          ...(media?.keys() ?? []),
        ]);
        if (!linked.size) linked.add("unlinked");
        let included = false;
        for (const key of linked) {
          const row = getRow(key);
          if (!row) continue;
          included = true;
          const files = media?.get(key) ?? [];
          row.visits.push({ ...visit, files });
          row.totals.visits++;
          if (!visit.punchedOutAt) row.totals.open++;
          countMedia(row.totals, files);
          countMedia(totals, files);
        }
        if (included) {
          totals.visits++;
          if (!visit.punchedOutAt) totals.open++;
        }
      }
      if (employeeRows.size) employees++;
      rows.push(
        ...[...employeeRows.values()].sort(
          (a, b) =>
            (a.project?.name ?? "").localeCompare(b.project?.name ?? "") ||
            (a.project?.code ?? "").localeCompare(b.project?.code ?? ""),
        ),
      );
    }
    const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(page, lastPage);
    return {
      projects,
      rows: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
      total: rows.length,
      page: currentPage,
      pageSize,
      totals: { ...totals, employees },
      timeZone: attendanceTimeZone,
    };
  }
}
