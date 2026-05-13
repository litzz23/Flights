# Flights

Flight booking app: React (Vite) frontend and Express + PostgreSQL backend.

## Render + Neon Deployment

Use Neon for PostgreSQL and Render for hosting the backend and frontend.

Backend environment variables on Render:

- `DATABASE_URL` from Neon with `sslmode=require`
- `JWT_SECRET`
- `KHALTI_SECRET_KEY`
- `KHALTI_BASE_URL`
- `NEXT_PUBLIC_SITE_URL` set to the deployed frontend URL
- `FRONTEND_URL` set to the deployed frontend URL

Frontend environment variables on Render:

- `VITE_API_URL` set to the deployed backend URL, ending in `/api`

If you deploy the frontend and backend separately, update the backend callback URL and frontend API base URL together so they point at the same production domains.

## Requirements

- Node.js 18+
- PostgreSQL

## Backend

```bash
cd backend
cp .env.example .env
# Edit .env: DB_* and JWT_SECRET
npm install
# Apply schema (see backend/db/schema.sql) and run your seed/init flow as needed
npm start
```

The API listens on `PORT` from `.env` (default `5000`). Point the frontend base URL in `frontend/src/api.js` at the same port.

For Neon in local development, either keep the `DB_*` values or switch to `DATABASE_URL`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Features

- Flight search, filters, and results
- Booking with passenger details and interactive seat map
- Wallet and booking management
- Peer seat swap requests

## License

Add your license here.
