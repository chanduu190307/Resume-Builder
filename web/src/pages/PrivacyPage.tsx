import { Link } from "react-router";

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "No accounts",
    body: [
      "There is no sign-up and no server-side storage of your data. Your resumes, saved jobs, cover letters and version history are stored only in this browser (IndexedDB).",
      "Clearing your browser's site data deletes them. Use “Backup & data” on the Resumes page to download a backup file you can restore later.",
    ],
  },
  {
    title: "What is sent to the engine",
    body: [
      "Importing, analysing and tailoring send the resume or job description to the resume engine, which processes it in memory and returns the result. It does not store or log resume or job content.",
      "If you import a job from a link, the engine fetches that public page. Links to private or local network addresses are refused.",
    ],
  },
  {
    title: "AI features (optional)",
    body: [
      "If the engine is configured with an AI key (this installation uses Groq), some features (AI-assisted import of unusual layouts, rewording suggestions, cover letter polish) send the relevant text to that AI provider's API to generate a suggestion. Without a key, these features are off and everything else works.",
      "Every AI suggestion is checked against your own resume before it is shown: proposals that add numbers, skills, names or experience you did not write are discarded. You choose what to accept.",
    ],
  },
  {
    title: "Truthfulness",
    body: [
      "The app never adds skills, employers, dates, degrees, metrics or experience to your resume on its own. Missing information is reported as a gap or asked of you. Wording you accept from AI is marked so you can always tell it apart from your own.",
    ],
  },
  {
    title: "Deleting your data",
    body: ["“Delete all data” on the Resumes page permanently removes every resume, application and saved version from this browser."],
  },
];

export function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy and your data</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">A plain summary of where your information goes.</p>
      <div className="mt-8 flex flex-col gap-6">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-base font-semibold tracking-tight">{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-ink-muted">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
      <Link to="/resumes" className="mt-10 inline-block text-sm font-medium text-accent hover:text-accent-hover">
        Back to your resumes
      </Link>
    </div>
  );
}
