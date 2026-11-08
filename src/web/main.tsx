import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { configResult } from "./config";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/schibsted-grotesk";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

if (configResult.ok) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  // Visible failure instead of a blank page (ADR-007).
  root.render(
    <div role="alert" style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Konfigurationsfehler</h1>
      <p>Die App ist falsch konfiguriert: {configResult.message}</p>
    </div>,
  );
}
