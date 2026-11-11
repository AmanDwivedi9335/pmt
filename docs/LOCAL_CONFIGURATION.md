# Local configuration

For a local web and API run on this Windows workspace, use `APP_ORIGIN=http://localhost:3001` and `WEB_PORT=3001` because pgAdmin uses port 3000. The API defaults to port 4000.

Set `DATABASE_URL` in the root `.env` to a MongoDB replica set. The development connection in `.env.example` uses port 27018. Start the supporting services and apply indexes:

```powershell
docker compose up -d --wait mongodb minio mailpit
pnpm db:push
pnpm dev
```

This Windows checkout uses the native replica set on port 27129. Its data is in `.local/mongodb-development`. If it stops, run this command from the repository root:

```powershell
& 'C:/Program Files/MongoDB/Server/6.0/bin/mongod.exe' --replSet pmt --bind_ip 127.0.0.1 --port 27129 --dbpath '.local/mongodb-development'
```

The existing replica set is already initialized. The root `.env` uses its local URI. To use Compose or an authenticated hosted replica set, set `DATABASE_URL` to that deployment's URI and run `pnpm db:push`.

Run `pnpm doctor` for connection and service checks. Run `pnpm doctor --login` to verify credentials from `SEED_EMAIL` and `SEED_PASSWORD`. Changing those variables does not reset a database password. Use `pnpm db:seed` for the optional development fixture or register a new account.
