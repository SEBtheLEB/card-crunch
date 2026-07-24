# Card Crunch Realtime

Cloudflare Worker and Durable Objects for Online Duel matchmaking and one-minute match rooms.

## Architecture

- `Matchmaker`: holds only waiting WebSockets, pairs two players, and creates a room.
- `MatchRoom`: owns the authoritative clock, opponent presence, score snapshots, forfeit, and final result.
- Vercel continues to host the game and its HTTP/Upstash route remains a transport fallback.

## Local development

```powershell
npm run cloudflare:dev
```

Create the production session-signing secret before the first deployment:

```powershell
npm run cloudflare:secret
npm run cloudflare:deploy
```

Production endpoint:

```text
https://card-crunch-realtime.stlprodz1101.workers.dev
```

The web client reads this from the `card-crunch-realtime-origin` meta tag. Vercel's Content Security Policy permits both the HTTPS session request and WSS game sockets. If realtime setup fails, the client automatically falls back to the existing HTTP/Upstash transport.

Run the production two-player integration check with Node.js 22 or newer:

```powershell
npm run cloudflare:test-live
```

## Security boundary

The room owns match timing and score settlement. The current compatibility protocol accepts monotonic score snapshots from the existing client. A later anti-cheat pass should send card actions and deck seeds so the room can calculate scores rather than accepting client totals.
