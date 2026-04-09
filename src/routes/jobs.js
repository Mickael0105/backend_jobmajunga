jobsRouter.get(
  "/",
  q("q").optional().isString(),
  q("contractType").optional().isIn(["CDI", "CDD", "Freelance", "Stage", "Alternance"]),
  q("location").optional().isString(),
  q("category").optional().isString(),
  q("salaryMin").optional().isFloat({ min: 0 }),
  q("salaryMax").optional().isFloat({ min: 0 }),
  q("lat").optional().isFloat(),
  q("lng").optional().isFloat(),
  q("radius").optional().isFloat({ min: 0 }),
  q("page").optional().isInt({ min: 1 }),
  q("pageSize").optional().isInt({ min: 1, max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const offset = (page - 1) * pageSize;

      const filters = [];
      const params = {};

      filters.push(`status = 'published'`);

      if (req.query.contractType) {
        filters.push(`contract_type = :contractType`);
        params.contractType = String(req.query.contractType);
      }
      if (req.query.location) {
        filters.push(`location LIKE :location`);
        params.location = `%${String(req.query.location)}%`;
      }
      if (req.query.category) {
        filters.push(`category = :category`);
        params.category = String(req.query.category);
      }
      if (req.query.q) {
        filters.push(`MATCH(title, description) AGAINST (:q IN NATURAL LANGUAGE MODE)`);
        params.q = String(req.query.q);
      }
      if (req.query.salaryMin) {
        filters.push(`(salary_max >= :salaryMin OR salary_max IS NULL)`);
        params.salaryMin = Number(req.query.salaryMin);
      }
      if (req.query.salaryMax) {
        filters.push(`(salary_min <= :salaryMax OR salary_min IS NULL)`);
        params.salaryMax = Number(req.query.salaryMax);
      }
      if (req.query.lat && req.query.lng && req.query.radius) {
        filters.push(
          `(6371 * acos(cos(radians(:lat)) * cos(radians(latitude)) * cos(radians(longitude) - radians(:lng)) + sin(radians(:lat)) * sin(radians(latitude)))) <= :radius`,
        );
        params.lat = Number(req.query.lat);
        params.lng = Number(req.query.lng);
        params.radius = Number(req.query.radius);
      }

      const safePageSize = Number.isFinite(pageSize)
        ? Math.min(Math.max(pageSize, 1), 100)
        : 20;
      const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const totalRows = await query(`SELECT COUNT(*) AS total FROM job_offers ${where}`, params);
      const total = Number(totalRows[0]?.total ?? 0);

      const rows = await query(
        `SELECT * FROM job_offers ${where}
         ORDER BY created_at DESC
         LIMIT ${safePageSize} OFFSET ${safeOffset}`,
        params,
      );

      res.json({
        items: rows.map(mapJobRow),
        page,
        pageSize,
        total,
      });
    } catch (err) {
      next(err);
    }
  },
);


