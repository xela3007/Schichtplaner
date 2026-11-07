// Railway Infrastructure as Code (ADR-014). Applied per environment with
//   railway config plan  --environment <staging|production>
//   railway config apply --environment <staging|production>
// Variables are unmanaged here: secrets live only in Railway (ADR-009).
import { defineRailway, github, project, service } from "railway/iac";

const REGION = "europe-west4-drams3a"; // EU, close to Neon Frankfurt

export default defineRailway((ctx) => {
  // staging deploys every green commit on main; production only the
  // `production` branch, which is fast-forwarded on explicit approval.
  const branch = ctx.isEnvironment("production") ? "production" : "main";
  const repo = github("xela3007/Schichtplaner", { branch, checkSuites: true });

  // Private API — no public domain; reached through the web service.
  const api = service("api", {
    source: repo,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.api",
      watchPatterns: [
        "/src/api/**",
        "/src/shared/**",
        "/drizzle/**",
        "/package.json",
        "/package-lock.json",
        "/tsconfig.base.json",
        "/tsconfig.json",
        "/Dockerfile.api",
      ],
    },
    deploy: {
      // Migrations run before the new version starts; failure keeps the old one.
      preDeployCommand: ["node dist/api/scripts/migrate.js"],
      healthcheckPath: "/health",
      healthcheckTimeout: 60,
      // restartPolicyType ON_FAILURE is Railway's default (stored as null) —
      // declaring it explicitly makes every plan report a phantom change.
      restartPolicyMaxRetries: 5,
    },
    replicas: { [REGION]: 1 },
  });

  // Public nginx: serves the SPA and forwards the API endpoints (same origin).
  const web = service("web", {
    source: repo,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.web",
      watchPatterns: [
        "/src/web/**",
        "/src/shared/**",
        "/deploy/nginx/**",
        "/package.json",
        "/package-lock.json",
        "/tsconfig.base.json",
        "/tsconfig.web.json",
        "/vite.config.ts",
        "/Dockerfile.web",
      ],
    },
    deploy: {
      healthcheckPath: "/web-health",
      healthcheckTimeout: 30,
      // restartPolicyType ON_FAILURE is Railway's default (stored as null) —
      // declaring it explicitly makes every plan report a phantom change.
      restartPolicyMaxRetries: 5,
    },
    replicas: { [REGION]: 1 },
  });

  return project("schichtplaner", {
    variables: { managed: false },
    resources: [api, web],
  });
});
