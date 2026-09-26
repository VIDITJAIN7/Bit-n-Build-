# Run Workkite on localhost

This guide installs Workkite for local development. It starts the web interface and API on your computer; no Vercel, Supabase, Firebase, wallet, or AI account is needed for the default rules-based setup.

## 1. Install prerequisites

Install:

- **Node.js 22.12 or newer** (npm is included with Node).
- **Python 3.11 or newer**.
- **Git**, if you have not already downloaded the repository.

Check that the commands are available:

```text
node --version
npm --version
python --version
```

On macOS/Linux, the Python command may be `python3`; use that command in the setup step below if `python` is unavailable.

## 2. Get the project

If you are cloning it:

```bash
git clone https://github.com/VIDITJAIN7/Workkite.git
cd Workkite
```

If the project is already on your computer, open a terminal in the repository root—the folder containing `package.json` and this README.

## 3. Install dependencies

On Windows PowerShell:

```powershell
npm run setup
```

This installs the JavaScript packages and creates `.venv` with the Python API dependencies. On macOS/Linux, use:

```bash
npm install
python3 scripts/setup.py
```

The first install needs an internet connection. You do not need to activate `.venv` manually; the local launcher uses it automatically.

## 4. Create local settings

Create a private `.env` file from the example.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Open `.env` and set local sign-in accounts. For example:

```dotenv
WORKKITE_LOCAL_USERS_JSON=[{"username":"admin","password":"choose-a-local-password","role":"admin","display_name":"Workspace Admin"},{"username":"worker1","password":"choose-another-password","role":"worker","display_name":"Field Worker"}]
```

Use private local passwords. `.env` is ignored by Git; do not commit it or use these credentials on a public site. Local login selects the interface role for development and does not provide production API security.

By default, Workkite starts with editable solar-farm starter sites and operational records. To begin with a blank company workspace instead, also set:

```dotenv
WORKKITE_LOCAL_EMPTY_WORKSPACE=true
WORKKITE_LOCAL_WORKSPACE_NAME=Your company
```

The blank workspace contains no sites, records, or tasks. Add them from the admin workspace after signing in. The local rules agent works without an API key. AI setup is optional; follow [the AI integration guide](integrations.md) if you want to configure one.

## 5. Start the app

From the repository root:

```bash
npm run dev
```

The launcher starts both services:

| Service | Local address |
| --- | --- |
| Workkite web app | <http://127.0.0.1:5173> |
| FastAPI backend | <http://127.0.0.1:8000> |
| API health check | <http://127.0.0.1:8000/api/health> |

Sign in with one of the usernames and passwords configured in `.env`. Use the admin account to create or edit tasks; use a worker account to view and complete assigned work. Stop both local services with **Ctrl+C** in the terminal.

## Troubleshooting

- **“Run npm run setup first.”** Run the dependency setup again from the repository root and confirm `.venv` was created.
- **Python cannot be found.** Install Python 3.11+, reopen the terminal, and check `python --version` (or `python3 --version` on macOS/Linux).
- **Port 5173 or 8000 is already in use.** Stop the other process using that port, then restart Workkite.
- **Sign-in fails.** Check that the JSON on the `WORKKITE_LOCAL_USERS_JSON` line is valid, and that the username, password, and role (`admin` or `worker`) are set.
- **The AI does not run.** AI is not required for local use. Check the server-side provider settings in `.env`; when no provider is configured, Workkite uses the rules planner.
- **You see sample solar records.** Set `WORKKITE_LOCAL_EMPTY_WORKSPACE=true`, then restart the local API. Existing SQLite data is retained; for a fresh blank local database, stop the app and remove the ignored database file in `apps/api/data/`.

For production hosting, use the [Vercel and Supabase deployment guide](deployment-vercel-supabase.md), not these local credentials or settings.
