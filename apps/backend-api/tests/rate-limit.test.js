"use strict";

const { createRateLimiters, cleanupExpiredRateLimits } = require("../middleware/rate-limit");

describe("rate limiter", () => {
  test("fails closed with 503 when the backing store errors", async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error("db unavailable")),
    };
    const { publicReadRateLimit } = createRateLimiters(pool);
    const req = {
      ip: "127.0.0.1",
      path: "/api/test",
      params: { guid: "abc" },
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    const next = jest.fn();

    await publicReadRateLimit(req, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Rate limiting is temporarily unavailable. Please retry shortly." });
    expect(next).not.toHaveBeenCalled();
  });

  test("cleanup removes expired rate-limit buckets", async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rowCount: 7 }),
    };

    const deleted = await cleanupExpiredRateLimits(pool);

    expect(deleted).toBe(7);
    expect(pool.query).toHaveBeenCalled();
  });
});
