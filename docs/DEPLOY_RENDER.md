# Deploy Raahi on Render

Raahi is ready to run as a **Node Web Service**. The server serves the interface and checked-in reference artifacts; sensing, planning, evaluation, and live simulation execute in each visitor's browser. No database, API keys, MATLAB installation, or asset compilation is required.

## Deploy with the included Blueprint

1. Commit and push these changes, including `render.yaml`, `.node-version`, and `package-lock.json`, to your Git repository.
2. In Render, choose **New → Blueprint** and connect that repository. Choose the branch containing these files.
3. Review the `raahi-driving-lab` web service and create it. The Blueprint selects the free plan; no database or persistent disk is provisioned.
4. Wait for the build tests and health check to pass, then open the service's HTTPS URL.

Render reads the service configuration from the root [Blueprint file](../render.yaml). See Render's [Blueprint reference](https://render.com/docs/blueprint-spec).

## Manual setup or an existing Render service

Use these settings if you already created a service, or prefer **New → Web Service**:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root directory | Leave blank when this project is at the repository root |
| Build command | `npm ci --no-audit --no-fund && npm test` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Environment variable | `NODE_ENV=production` |
| Environment variable | `HOST=0.0.0.0` |
| Node version | Node 24, selected by `.node-version` |

Let Render supply `PORT`; do not hardcode `4173` in the dashboard. The server honors that port and binds to `0.0.0.0` in production as required by [Render web services](https://render.com/docs/web-services). If an existing service has a `NODE_VERSION` override, remove it or set it to `24`, because it takes precedence over `.node-version` ([version selection](https://render.com/docs/node-version)).

The server also recognizes Render's `RENDER=true` environment flag. `SIGTERM` stops accepting new connections and allows active requests up to ten seconds to finish. The `/healthz` endpoint supports GET and HEAD; Render can use it for [health checks](https://render.com/docs/health-checks).

## Storage and downloads

- **Hosted video exports:** recordings download directly to the visitor's device. Production refuses `/api/recordings` uploads, so anonymous visitors cannot fill server storage. The interface reads `/api/config` to select this behavior automatically.
- **Local development:** `npm start` without production environment variables still binds to `127.0.0.1:4173`. Recordings are downloaded and additionally saved to `artifacts/` when the local save succeeds.
- **JSON, CSV, and run logs:** exports are generated in the browser and downloaded directly; no server write is needed.
- **Run history and preferences:** stored in that browser for that website address. Localhost history does not transfer to the Render URL. Different browsers, devices, and custom domains have separate histories; clearing site data removes them. Export important runs to keep a copy.
- **Reference results:** the checked-in `artifacts/` files are served with the application on every deployment.

Render's default filesystem is temporary across deploys. This setup does not depend on it for user data ([Render deploys](https://render.com/docs/deploys)).

## Verify the deployment

1. Visit `/healthz` on your deployed URL: expect `{"status":"ok"}`. Visit `/api/config`: expect `{"localRecordingSave":false}`.
2. Open the homepage. Switch dark mode and collapse/expand the scenario menu. Check on both a desktop and a phone-sized window.
3. Run a scenario, inject a hazard, and use JSON/CSV exports. Run **Evaluate all scenarios** to exercise the five scenes.
4. Record a short demo, then stop. A WebM download should be offered without a server-save error. Browser support for canvas capture and WebM MediaRecorder is required.
5. Finish a scenario and reload: its summary should remain in this browser's run history.

To check production behavior locally in PowerShell:

```powershell
$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = '4180'
npm start
# Open http://127.0.0.1:4180. Press Ctrl+C when done.
Remove-Item Env:NODE_ENV, Env:HOST, Env:PORT
```

`npm test` runs in the build and prevents deployment when a regression fails. There is no `npm run build` step and no `dist` directory. Use a **Web Service**, not a Static Site, for this configuration.

Deployment publishes the existing browser research prototype. It does not add native Simulink/RoadRunner integration or change the scope of the validation evidence described in [the README](../README.md).
