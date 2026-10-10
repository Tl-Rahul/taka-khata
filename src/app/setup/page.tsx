export const metadata = { title: "Setup" };

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-2xl font-semibold">টাকার খাতা — setup needed</h1>
      <p className="mt-3 text-muted">
        The app is not connected to a Supabase project yet. Add these environment variables (in Vercel: Project → Settings → Environment Variables, or locally in <code>.env.local</code>) and redeploy:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-4 text-sm">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ALLOWED_EMAILS=you@example.com`}
      </pre>
      <p className="mt-4 text-muted">Then run the SQL files in <code>supabase/migrations</code> in the Supabase SQL editor. See README.md for the full guide.</p>
    </main>
  );
}
