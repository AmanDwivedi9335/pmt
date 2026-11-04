import { z } from "zod";
import Decimal from "decimal.js";
export { z, Decimal };
export const uuid = z.string().uuid();
export const quantity = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,4})?$/,
    "Use a positive decimal with at most four decimal places",
  )
  .refine((v) => new Decimal(v).gt(0), "Must be greater than zero");
export const money = z
  .string()
  .regex(
    /^\d{1,14}(\.\d{1,2})?$/,
    "Use a decimal with at most two decimal places",
  );
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid calendar date",
  );
export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(12).max(128);
export const permissions = [
  "organization.manage",
  "team.manage",
  "project.view",
  "project.create",
  "project.edit",
  "project.approve",
  "material.manage",
  "workorder.manage",
  "import.create",
  "procurement.manage",
  "stock.create",
  "stock.reverse",
  "installation.create",
  "installation.verify",
  "installation.approve",
  "invoice.create",
  "invoice.approve",
  "payment.create",
  "task.manage",
  "document.manage",
  "report.export",
] as const;
const view = ["project.view"];
export const roleDefaults: Record<string, string[]> = {
  SUPER_ADMIN: [...permissions],
  ORGANIZATION_ADMIN: [...permissions],
  PROJECT_MANAGER: [
    ...view,
    "project.edit",
    "project.approve",
    "workorder.manage",
    "import.create",
    "procurement.manage",
    "stock.reverse",
    "installation.verify",
    "installation.approve",
    "task.manage",
    "document.manage",
    "report.export",
  ],
  SITE_ENGINEER: [
    ...view,
    "installation.create",
    "task.manage",
    "document.manage",
  ],
  PROCUREMENT_OFFICER: [...view, "procurement.manage", "material.manage"],
  STOREKEEPER: [...view, "stock.create"],
  ACCOUNTS: [
    ...view,
    "invoice.create",
    "invoice.approve",
    "payment.create",
    "report.export",
  ],
  MANAGEMENT_VIEWER: [...view, "report.export"],
  CLIENT_VIEWER: [...view],
};
export const projectTransitions: Record<string, string[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["ACTIVE", "ON_HOLD", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "DELAYED", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  DELAYED: ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"],
  COMPLETED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};
export function balances(
  ordered: Decimal.Value,
  supplied: Decimal.Value,
  installed: Decimal.Value,
  supplyBilled: Decimal.Value = 0,
  installationBilled: Decimal.Value = 0,
) {
  const o = new Decimal(ordered),
    s = new Decimal(supplied),
    i = new Decimal(installed);
  return {
    ordered: o.toFixed(),
    supplied: s.toFixed(),
    installed: i.toFixed(),
    pendingSupply: o.minus(s).toFixed(),
    pendingInstallation: o.minus(i).toFixed(),
    available: s.minus(i).toFixed(),
    supplyUnbilled: s.minus(supplyBilled).toFixed(),
    installationUnbilled: i.minus(installationBilled).toFixed(),
  };
}
