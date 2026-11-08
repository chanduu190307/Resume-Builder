import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { EditorPage } from "./pages/EditorPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ImportPage } from "./pages/ImportPage.tsx";
import { JobsPage } from "./pages/JobsPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { PrivacyPage } from "./pages/PrivacyPage.tsx";
import { TailorPage } from "./pages/TailorPage.tsx";
import { TailorStartPage } from "./pages/TailorStartPage.tsx";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "resumes", element: <LibraryPage /> },
      { path: "import", element: <ImportPage /> },
      { path: "resumes/:id", element: <EditorPage /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "tailor", element: <TailorStartPage /> },
      { path: "tailor/:id", element: <TailorPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
