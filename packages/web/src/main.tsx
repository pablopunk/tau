import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { applyTheme } from "./lib/theme";
import "./index.css";

applyTheme();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const morphDemo = import.meta.env.VITE_FAKE && new URLSearchParams(location.search).get("fake") === "morph";

const render = (element: React.ReactNode) => createRoot(root).render(<StrictMode>{element}</StrictMode>);

if (morphDemo) void import("./dev/MorphDemo").then(({ MorphDemo }) => render(<MorphDemo />));
else render(<App />);
