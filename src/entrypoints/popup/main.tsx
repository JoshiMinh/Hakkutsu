import React from "react";
import ReactDOM from "react-dom/client";
import "~/styles/global.css";

// Keep the HTML loading state visible while the popup's code is loading.
void import("~/app/popup").then(({ default: Popup, ErrorBoundary }) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary><Popup /></ErrorBoundary>
    </React.StrictMode>
  );
}).catch(error => {
  console.error("[Hakkutsu] Popup startup failed:", error);
  const root = document.getElementById("root")!;
  root.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "Hakkutsu could not start. Reload the extension and try again.";
  message.setAttribute("role", "alert");
  const retry = document.createElement("button");
  retry.textContent = "Retry";
  retry.addEventListener("click", () => window.location.reload());
  root.append(message, retry);
});

