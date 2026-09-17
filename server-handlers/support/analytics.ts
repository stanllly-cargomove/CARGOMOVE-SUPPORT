import type { Request, Response } from "express";
import { supportRead, supportFilters } from "./queries.js";
export default function analytics(req: Request, res: Response) {
  return supportRead(req, res, "support_analytics", () => {
    const filters = supportFilters({ from: req.query.from, to: req.query.to });
    return { p_from: filters.from || null, p_to: filters.to || null };
  });
}
