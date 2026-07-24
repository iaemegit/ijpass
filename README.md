# IJPAss Web Platform

Full-stack foundation for the International Journal Publishers Association.

## Setup

1. Run `npm install` from the project root.
2. Copy `server/.env.example` to `server/.env` and update the MySQL credentials.
3. Run `npm run prisma:generate --workspace server`.
4. Run `npm run prisma:migrate --workspace server` to create the database.
5. Run `npm run dev` to start the React app and Express API.

Frontend: `http://localhost:5173`  
API: `http://localhost:4000`

The starter includes every requested route, responsive Bootstrap navigation, reusable content pages, validated enquiry forms, and Prisma models for users, applications, journals, and contact messages. Elasticsearch and mail credentials are represented in the environment template and can be connected when production infrastructure is available.
