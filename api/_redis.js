import { randomUUID } from "node:crypto";
import { MemoryMatchmakingStore } from "./_matchmakingCore.js";

let memoryStore = null;

export function createMatchmakingStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return new RedisMatchmakingStore({ url, token });
  if (process.env.MATCHMAKING_MEMORY === "1" && process.env.VERCEL_ENV !== "production") {
    memoryStore ??= new MemoryMatchmakingStore();
    return memoryStore;
  }
  return null;
}

class RedisMatchmakingStore {
  constructor({ url, token }) {
    this.url = String(url).replace(/\/$/, "");
    this.token = token;
  }

  async command(...args) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(args)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || "Redis command failed");
    return payload.result;
  }

  async withLock(key, operation) {
    const token = randomUUID();
    const deadline = Date.now() + 3_000;
    let acquired = false;
    while (!acquired && Date.now() < deadline) {
      acquired = (await this.command("SET", key, token, "NX", "PX", "2500")) === "OK";
      if (!acquired) await new Promise((resolve) => setTimeout(resolve, 45 + Math.random() * 35));
    }
    if (!acquired) throw new Error("Matchmaking is busy. Please retry.");
    try {
      return await operation();
    } finally {
      await this.command(
        "EVAL",
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        "1",
        key,
        token
      ).catch(() => {});
    }
  }

  async getJson(key) {
    const value = await this.command("GET", key);
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  }

  async setJson(key, value, ttlSeconds = 0) {
    const args = ["SET", key, JSON.stringify(value)];
    if (ttlSeconds > 0) args.push("EX", String(ttlSeconds));
    await this.command(...args);
  }

  async zadd(key, score, member) {
    await this.command("ZADD", key, String(score), member);
  }

  async zrem(key, member) {
    await this.command("ZREM", key, member);
  }

  async zrangeByScore(key, min, max, limit = 64) {
    const result = await this.command("ZRANGEBYSCORE", key, String(min), String(max), "LIMIT", "0", String(limit));
    return Array.isArray(result) ? result.map(String) : [];
  }
}
