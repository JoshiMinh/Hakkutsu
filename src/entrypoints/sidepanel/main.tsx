import { createRoot } from "react-dom/client";
import TranscriptPanel from "~/app/transcript-panel";
import "~/styles/global.css";

createRoot(document.getElementById("root")!).render(<TranscriptPanel />);
